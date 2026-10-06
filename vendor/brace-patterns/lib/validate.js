'use strict';

const { MAX_DEPTH, MAX_NODES, MAX_OUTPUT_LENGTH } = require('./constants');

// Walk child edges, not the parser's deliberate parent/prev back references.
// Explicit frames keep malicious direct-AST callers off the JavaScript stack.
module.exports = ast => {
  const active = new Set();
  const stack = [{ node: ast, depth: 0, exit: false }];
  let scheduled = 1;
  while (stack.length) {
    const frame = stack.pop();
    const { node, depth } = frame;
    if (frame.exit) {
      active.delete(node);
      continue;
    }
    if (depth > MAX_DEPTH + 1) {
      throw new SyntaxError(`AST nesting exceeds max depth (${MAX_DEPTH})`);
    }
    if (!node || typeof node !== 'object' || active.has(node)) {
      throw new SyntaxError('AST contains a child cycle or invalid node');
    }
    if (node.value !== undefined && typeof node.value !== 'string') {
      throw new SyntaxError('AST values must be strings');
    }
    if (node.value && node.value.length > MAX_OUTPUT_LENGTH) {
      throw new RangeError('AST value exceeds hard character limit');
    }
    // Expansion consults parent links. Check those independently so callers
    // cannot make its ancestor lookup loop even with acyclic child edges.
    const parents = new Set([node]);
    let parent = node.parent;
    while (parent) {
      if (typeof parent !== 'object' || !['root', 'brace', 'paren'].includes(parent.type)) {
        throw new SyntaxError('AST contains an invalid parent link');
      }
      if (parents.has(parent) || parents.size > MAX_DEPTH + 2) {
        throw new SyntaxError('AST contains a cyclic or over-depth parent link');
      }
      parents.add(parent);
      parent = parent.parent;
    }
    if (node.nodes !== undefined && !Array.isArray(node.nodes)) {
      throw new SyntaxError('AST nodes must be an array');
    }
    active.add(node);
    stack.push({ node, exit: true });
    if (node.nodes) {
      // Reject pending work before allocating one frame per child. A shared
      // DAG may repeat edges, so count traversal work rather than unique nodes.
      scheduled += node.nodes.length;
      if (scheduled > MAX_NODES) {
        throw new SyntaxError(`AST exceeds max nodes (${MAX_NODES})`);
      }
      for (let i = node.nodes.length - 1; i >= 0; i--) {
        stack.push({ node: node.nodes[i], parent: node, depth: depth + 1, exit: false });
      }
    }
  }
};
