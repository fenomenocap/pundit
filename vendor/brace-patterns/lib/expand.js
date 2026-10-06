'use strict';

const fill = require('fill-range');
const stringify = require('./stringify');
const utils = require('./utils');
const validate = require('./validate');
const { MAX_EXPANSIONS, MAX_OUTPUT_LENGTH } = require('./constants');

const budgetError = () => new RangeError(`expanded array length exceeds hard expansion limit (${MAX_EXPANSIONS})`);

// The old recursive Cartesian append and flatten paths were independently
// stack-exhaustible by direct AST callers. Flatten first and multiply once.
const append = (queue = '', stash = '', enclose = false) => {
  queue = utils.flatten([].concat(queue));
  stash = utils.flatten([].concat(stash));
  if (!stash.length) return queue;
  if (!queue.length) queue = [''];
  if (queue.length * stash.length > MAX_EXPANSIONS) throw budgetError();
  const result = [];
  let length = 0;
  for (const item of queue) {
    for (let value of stash) {
      if (enclose === true && typeof value === 'string') value = `{${value}}`;
      const joined = item + value;
      length += joined.length;
      if (length > MAX_OUTPUT_LENGTH) throw new RangeError('expanded output exceeds hard character limit');
      result.push(joined);
    }
  }
  return result;
};

module.exports = (ast, options = {}) => {
  validate(ast);
  const rangeLimit = options.rangeLimit === undefined ? 1000 : options.rangeLimit;
  const frames = [{ node: ast, parent: {}, entered: false }];
  let result;
  while (frames.length) {
    const frame = frames[frames.length - 1];
    const { node, parent } = frame;
    if (!frame.entered) {
      frame.entered = true;
      node.queue = [];
      let p = parent;
      let q = parent.queue;
      while (p.type !== 'brace' && p.type !== 'root' && p.parent) {
        p = p.parent;
        q = p.queue;
      }
      frame.q = q;
      if (node.invalid || node.dollar) {
        q.push(append(q.pop(), stringify(node, options)));
        frames.pop();
        continue;
      }
      if (node.type === 'brace' && node.invalid !== true && node.nodes.length === 2) {
        q.push(append(q.pop(), ['{}']));
        frames.pop();
        continue;
      }
      if (node.nodes && node.ranges > 0) {
        const args = utils.reduce(node.nodes);
        if (utils.exceedsLimit(...args, options.step, rangeLimit)) {
          throw new RangeError('expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.');
        }
        if (utils.isInteger(args[0]) && utils.isInteger(args[1])) {
          const step = Math.abs(Number(args[2] ?? options.step ?? 1)) || 1;
          const count = Math.floor(Math.abs(Number(args[1]) - Number(args[0])) / step) + 1;
          if (!Number.isFinite(count) || count > MAX_EXPANSIONS) throw budgetError();
          if (count * Math.max(String(args[0]).length, String(args[1]).length) > MAX_OUTPUT_LENGTH) {
            throw new RangeError('expanded output exceeds hard character limit');
          }
        }
        let range = fill(...args, options);
        if (range.length === 0) range = stringify(node, options);
        q.push(append(q.pop(), range));
        node.nodes = [];
        frames.pop();
        continue;
      }
      frame.enclose = utils.encloseBrace(node);
      frame.queue = node.queue;
      let block = node;
      while (block.type !== 'brace' && block.type !== 'root' && block.parent) {
        block = block.parent;
        frame.queue = block.queue;
      }
      frame.index = 0;
      if (frames.length === 1) result = frame.queue;
    }
    if (frame.index >= node.nodes.length) {
      frames.pop();
      continue;
    }
    const index = frame.index++;
    const child = node.nodes[index];
    if (child.type === 'comma' && node.type === 'brace') {
      if (index === 1) frame.queue.push('');
      frame.queue.push('');
    } else if (child.type === 'close') {
      frame.q.push(append(frame.q.pop(), frame.queue, frame.enclose));
    } else if (child.value && child.type !== 'open') {
      frame.queue.push(append(frame.queue.pop(), child.value));
    } else if (child.nodes) {
      frames.push({ node: child, parent: node, entered: false });
    }
  }
  return utils.flatten(result);
};
