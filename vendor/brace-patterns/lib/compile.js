'use strict';

const fill = require('fill-range');
const utils = require('./utils');
const validate = require('./validate');
const { MAX_OUTPUT_LENGTH } = require('./constants');

module.exports = (ast, options = {}) => {
  validate(ast);
  const stack = [{ node: ast, parent: {} }];
  const chunks = [];
  let length = 0;
  const emit = value => {
    length += value.length;
    if (length > MAX_OUTPUT_LENGTH) throw new RangeError('output exceeds hard character limit');
    chunks.push(value);
  };
  const prefix = options.escapeInvalid === true ? '\\' : '';
  while (stack.length) {
    const { node, parent } = stack.pop();
    const invalid = utils.isInvalidBrace(parent) || (node.invalid === true && options.escapeInvalid === true);
    if (node.isOpen === true || node.isClose === true) {
      emit(prefix + node.value);
    } else if (node.type === 'open') {
      emit(invalid ? prefix + node.value : '(');
    } else if (node.type === 'close') {
      emit(invalid ? prefix + node.value : ')');
    } else if (node.type === 'comma') {
      emit(node.prev.type === 'comma' ? '' : invalid ? node.value : '|');
    } else if (node.value) {
      emit(node.value);
    } else {
      if (node.nodes && node.ranges > 0) {
        const args = utils.reduce(node.nodes);
        const range = fill(...args, { ...options, wrap: false, toRegex: true, strictZeros: true });
        if (range.length !== 0) {
          emit(args.length > 1 && range.length > 1 ? `(${range})` : range);
          continue;
        }
      }
      if (node.nodes) {
        for (let i = node.nodes.length - 1; i >= 0; i--) {
          stack.push({ node: node.nodes[i], parent: node });
        }
      }
    }
  }
  return chunks.join('');
};
