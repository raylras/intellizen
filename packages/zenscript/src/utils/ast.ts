import type { AstNode, AstNodeDescription, Stream, URI } from 'langium'
import type { ClassDeclaration } from '../generated/ast'
import { AstUtils, isAstNodeDescription } from 'langium'
import * as ast from '../generated/ast'
import { isZs } from './document'
import { toStream } from './stream'

export function isToplevel(node: AstNode | undefined): boolean {
  return ast.isScript(node?.$container)
}

export function isStatic(node: AstNode) {
  return node && 'variance' in node && node.variance === 'static'
}

export function isGlobal(node: AstNode) {
  return node && 'variance' in node && node.variance === 'global'
}

export function isReadonly(node: AstNode) {
  return node && 'variance' in node && typeof node.variance === 'string' && /val|static|global/.test(node.variance)
}

export function isExposed(node: AstNode | undefined) {
  if (ast.isScript(node)) {
    return isZs(AstUtils.getDocument(node))
  }
  else if (isToplevel(node)) {
    if (ast.isFunctionDeclaration(node)) {
      return node.variance === undefined
    }
    else if (ast.isVariableDeclaration(node)) {
      return node.variance === 'static'
    }
    else if (ast.isClassDeclaration(node)) {
      return true
    }
  }
  else if (ast.isClassMemberDeclaration(node)) {
    return 'variance' in node && node.variance === 'static'
  }
}

export function getDocumentUri(node: AstNode | undefined): URI | undefined {
  let current = node
  while (current) {
    if (current.$document) {
      return current.$document.uri
    }
    current = current.$container
  }
}

export function getPathAsString(element: ast.BracketExpression, index?: number): string {
  const separator = ':'
  let names = element.path.map(it => it.$cstNode!.text)
  if (index !== undefined) {
    names = names.slice(0, index + 1)
  }
  return names.join(separator)
}

export function toAstNode(item: AstNode | AstNodeDescription): AstNode | undefined {
  return isAstNodeDescription(item) ? item.node : item
}

export function streamClassChain(decl: ClassDeclaration | undefined): Stream<ClassDeclaration> {
  return toStream(function* () {
    const visited = new Set<ClassDeclaration>()
    const deque = [decl]
    while (deque.length) {
      const head = deque.shift()
      if (!head || visited.has(head)) {
        continue
      }

      yield head
      visited.add(head)
      head.superTypes
        .map(it => it.item.entity?.ref)
        .filter(ast.isClassDeclaration)
        .forEach(it => deque.push(it))
    }
  })
}

export function getDirectChildOf(container: AstNode, seed: AstNode): AstNode {
  let node: AstNode | undefined = seed
  while (node) {
    if (node.$container === container) {
      return node
    }
    node = node.$container
  }
  throw new Error('Direct child not found')
}
