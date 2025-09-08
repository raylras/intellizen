import type { AstNode, AstNodeDescription, Stream, URI } from 'langium'
import type { ClassDeclaration } from '../generated/ast'
import { AstUtils, isAstNodeDescription } from 'langium'
import * as ast from '../generated/ast'
import { isZs } from './document'
import { toStream } from './stream'

export function isToplevel(node: AstNode | undefined): boolean {
  return ast.isScript(node?.$container)
}

export function isStatic(node: AstNode | undefined) {
  return node && 'variance' in node && node.variance === 'static'
}

export function isGlobal(node: AstNode | undefined) {
  return node && 'variance' in node && node.variance === 'global'
}

export function isVal(node: AstNode | undefined) {
  return node && 'variance' in node && node.variance === 'val'
}

export function isReadonly(node: AstNode | undefined) {
  return node && 'variance' in node && typeof node.variance === 'string' && /^(?:val|static|global)$/.test(node.variance)
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

export function streamClassChain(classDecl: ClassDeclaration): Stream<ClassDeclaration> {
  return toStream(function* () {
    const visited = new Set<ClassDeclaration>()
    const deque = [classDecl]
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

/**
 * Binary search for the upper bound of the specified target value.
 *
 * @param elements The array to search, **MUST** be sorted
 * @param target The target value
 * @param map The mapping function to map the element to a number
 * @returns The upper bound of the target value in closed range `[0, elements.length]`
 *
 * @example
 * binarySearchUpperBound([1, 3, 5, 7], 6)
 * // returns 2
 * // [1, 3, 5, 7]
 * //        ^ bound === 2
 *
 * @example
 * binarySearchUpperBound([1, 3, 5, 7], 10)
 * // returns 4
 * // [1, 3, 5, 7]
 * //             ^ bound === elements.length (Not inside the array)
 *
 * @example
 * binarySearchUpperBound([1, 3, 5, 7], 0)
 * // returns 0
 * // [1, 3, 5, 7]
 * //  ^ bound === 0
 */
export function binarySearchUpperBound<E>(elements: E[], target: number, map: (elm: E) => number): number {
  let low = 0
  let high = elements.length - 1
  while (low <= high) {
    const mid = Math.floor(low + (high - low) / 2)
    const midVal = map(elements[mid])
    if (midVal < target)
      low = mid + 1
    else
      high = mid - 1
  }
  return low
}
