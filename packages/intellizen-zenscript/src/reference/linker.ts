import type { AstNode, AstNodeDescription, AstNodeDescriptionProvider, LinkingError, ReferenceInfo } from 'langium'
import type { ImportItem, NamedTypeItem } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import type { OverloadResolver } from './overload-resolver'
import type { SyntheticAstNode } from './synthetic'
import { DefaultLinker } from 'langium'
import { isAccessExpression, isFieldDeclaration, isImportDeclaration, isImportItem, isNamedTypeItem } from '../generated/ast'
import { createSyntheticDescription, isSyntheticAstNode, SyntheticUnknown } from './synthetic'

export class ZenScriptLinker extends DefaultLinker {
  private readonly overloadResolver: OverloadResolver
  private readonly descriptions: AstNodeDescriptionProvider

  constructor(services: ZenScriptServices) {
    super(services)
    this.overloadResolver = services.references.OverloadResolver
    this.descriptions = services.workspace.AstNodeDescriptionProvider
  }

  override getCandidate(info: ReferenceInfo): AstNodeDescription | LinkingError {
    const scope = this.scopeProvider.getScope(info)

    if (isAccessExpression(info.container)) {
      const symbols = scope.getElements(info.reference.$refText).toArray()
      if (symbols.length) {
        if (info.container.withArgs) {
          const overloads = this.overloadResolver.resolveOverloads(info.container, symbols.map(it => it.node!))
          const symbol = this.descriptions.getDescription(overloads[0])
          return symbol ?? symbols[0]
        }
        else {
          const field = symbols.find(it => isFieldDeclaration(it.node))
          return field ?? symbols[0]
        }
      }
    }

    const symbol = scope.getElement(info.reference.$refText)
    if (symbol) {
      return this.redirectImportIfNeeded(symbol)
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

  private redirectImportIfNeeded(symbol: AstNodeDescription): AstNodeDescription {
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
