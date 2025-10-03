import type { AstNode, AstNodeDescription } from 'langium'
import type { NamespaceNode } from '../utils/namespace-tree'
import { URI } from 'langium'

export interface ZenScriptSyntheticAstType {
  SyntheticAstNode: SyntheticAstNode
}

export interface SyntheticAstNode extends AstNode {
  $type: 'SyntheticAstNode'
  content: SyntheticContent
}

export type SyntheticContent = NamespaceNode<AstNode> | typeof SyntheticUnknown

export const SyntheticUnknown = Symbol('SyntheticUnknown')

/**
 * Wrap a given content as an AstNode.
 * This is used to create synthetic nodes for the purpose of linking.
 *
 * @param content The content to wrap
 * @returns The wrapped content as an AstNode.
 */
export function createSyntheticAstNode(content: SyntheticContent): SyntheticAstNode {
  return {
    $type: 'SyntheticAstNode',
    content,
  }
}

/**
 * Wrap a given content as an AstNodeDescription.
 * This is used to create synthetic descriptions for the purpose of linking.
 *
 * @param name The name of the synthetic node
 * @param content The content to wrap
 * @returns The wrapped content as an AstNodeDescription.
 */
export function createSyntheticDescription(name: string, content: SyntheticContent): AstNodeDescription {
  return {
    name,
    type: 'SyntheticAstNode',
    node: createSyntheticAstNode(content),
    documentUri: URI.from({ scheme: 'synthetic', path: name }),
    path: '',
  }
}

export function isSyntheticAstNode(node: unknown): node is SyntheticAstNode {
  return typeof node === 'object' && node !== null && '$type' in node && node.$type === 'SyntheticAstNode'
}
