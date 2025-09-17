import type { AstNode, AstNodeDescription, LinkingError, ReferenceInfo } from 'langium'
import type { ImportItem, NamedTypeItem } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import type { SyntheticAstNode } from './synthetic'
import { DefaultLinker } from 'langium'
import { isImportDeclaration, isImportItem, isNamedTypeItem } from '../generated/ast'
import { createSyntheticDescription, isSyntheticAstNode, SyntheticUnknown } from './synthetic'

export class ZenScriptLinker extends DefaultLinker {
  constructor(services: ZenScriptServices) {
    super(services)
  }

  override getCandidate(info: ReferenceInfo): AstNodeDescription | LinkingError {
    const scope = this.scopeProvider.getScope(info)
    const description = scope.getElement(info.reference.$refText)
    if (description) {
      return this.redirectIfNeeded(description)
    }

    // Prevent creating a bunch of errors for broken references
    if (isImportItem(info.container) || isNamedTypeItem(info.container)) {
      let node: ImportItem | NamedTypeItem | undefined = info.container
      let isBroken = false
      while (node) {
        if (node.previous?.entity.error) {
          isBroken = true
          break
        }
        node = node.previous
      }
      if (isBroken) {
        // Previous is broken; we don't need more errors here
        return createSyntheticDescription(info.reference.$refText, SyntheticUnknown)
      }
    }

    return this.createLinkingError(info)
  }

  private redirectIfNeeded(symbol: AstNodeDescription): AstNodeDescription {
    const node = symbol?.node
    if (isImportDeclaration(node)) {
      const entity = node.item?.entity?.ref as AstNode | SyntheticAstNode
      // do not redirect aliased or unknown imports
      const shouldRedirect = !node.alias && !(isSyntheticAstNode(entity) && entity.content === SyntheticUnknown)
      if (shouldRedirect) {
        const newSymbol = node.item.entity.$nodeDescription
        return newSymbol ?? symbol
      }
    }
    return symbol
  }

  override getCandidates(refInfo: ReferenceInfo): AstNodeDescription[] | LinkingError {
    // TODO: multi reference
    return this.createLinkingError(refInfo)
  }
}
