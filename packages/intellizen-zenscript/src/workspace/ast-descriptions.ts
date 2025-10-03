import type { AstNode, AstNodeDescription, AstNodeDescriptionProvider, AstNodeLocator, LangiumDocument, NameProvider } from 'langium'
import type { ZenScriptServices } from '../module'
import { CstUtils, URI } from 'langium'
import { getDocumentUri } from '../utils/ast'

declare module 'langium' {
  interface AstNodeDescriptionProvider {
    getDescription: (node: AstNode) => AstNodeDescription | undefined
    getOrCreateDescription: (node: AstNode, name: string, uri?: URI,) => AstNodeDescription
  }
}

export class ZenScriptAstNodeDescriptionProvider implements AstNodeDescriptionProvider {
  private readonly astNodeLocator: AstNodeLocator
  private readonly nameProvider: NameProvider
  private readonly cache: WeakMap<AstNode, AstNodeDescription>

  constructor(services: ZenScriptServices) {
    this.astNodeLocator = services.workspace.AstNodeLocator
    this.nameProvider = services.references.NameProvider
    this.cache = new WeakMap()
  }

  getDescription(node: AstNode): AstNodeDescription | undefined {
    return this.cache.get(node)
  }

  getOrCreateDescription(node: AstNode, name: string, uri?: URI): AstNodeDescription {
    let desc = this.cache.get(node)
    if (desc) {
      return desc
    }
    else {
      desc = uri ? this.createDescriptionWithUri(node, name, uri) : this.createDescription(node, name)
      this.cache.set(node, desc)
      return desc
    }
  }

  createDescription(node: AstNode, name: string, document?: LangiumDocument): AstNodeDescription {
    const uri = document?.uri ?? getDocumentUri(node) ?? URI.from({ scheme: 'unknown' })
    return this.createDescriptionWithUri(node, name, uri)
  }

  createDescriptionWithUri(node: AstNode, name: string, uri: URI): AstNodeDescription {
    const astNodeLocator = this.astNodeLocator
    const nameProvider = this.nameProvider
    return {
      node,
      name,
      type: node.$type,
      documentUri: uri,
      get nameSegment() {
        const nameNode = nameProvider.getNameNode(node) ?? node.$cstNode
        const _nameSegment = CstUtils.toDocumentSegment(nameNode)
        Object.defineProperty(this, 'nameSegment', { value: _nameSegment })
        return _nameSegment
      },
      get selectionSegment() {
        const _selectionSegment = CstUtils.toDocumentSegment(node.$cstNode)
        Object.defineProperty(this, 'selectionSegment', { value: _selectionSegment })
        return _selectionSegment
      },
      get path() {
        const _path = astNodeLocator.getAstNodePath(node)
        Object.defineProperty(this, 'path', { value: _path })
        return _path
      },
    }
  }
}
