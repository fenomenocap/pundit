'use strict';

const utils = require('./utils');
const validate = require('./validate');
const { MAX_OUTPUT_LENGTH } = require('./constants');

module.exports = (ast, options = {}) => {
  validate(ast);
  const stack = [ast];
  const chunks = [];
  let length = 0;
  const emit = value => {
    length += value.length;
    if (length > MAX_OUTPUT_LENGTH) throw new RangeError('output exceeds hard character limit');
    chunks.push(value);
  };
  while (stack.length) {
    const node = stack.pop();
    if (node.value) {
      // Preserve upstream stringify semantics: descendant parent context is
      // intentionally not inherited, unlike regex compilation.
      emit(node.invalid === true && options.escapeInvalid === true && utils.isOpenOrClose(node)
        ? '\\' + node.value : node.value);
    } else if (node.nodes) {
      for (let i = node.nodes.length - 1; i >= 0; i--) stack.push(node.nodes[i]);
    }
  }
  return chunks.join('');
};
