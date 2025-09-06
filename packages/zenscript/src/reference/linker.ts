import type { AstNodeDescription, LinkingError, ReferenceInfo } from 'langium'
import type { ZenScriptServices } from '../module'
import { DefaultLinker } from 'langium'
import { isImportDeclaration, isImportItem, isNamedTypeItem } from '../generated/ast'
import { createSyntheticAstNodeDescription } from './synthetic'

export class ZenScriptLinker extends DefaultLinker {
  constructor(services: ZenScriptServices) {
    super(services)
  }

  override getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError {
    const scope = this.scopeProvider.getScope(refInfo)
    const description = scope.getElement(refInfo.reference.$refText)
    if (description) {
      const node = description.node
      if (isImportDeclaration(node) && !node.alias) {
        // trigger linking (available the $nodeDescription)
        const _sideEffect = node.item.entity.ref
        const nodeDescription = node.item.entity?.$nodeDescription
        return nodeDescription ?? description
      }
      else {
        return description
      }
    }

    // Prevent creating a bunch of errors for broken references
    const { container } = refInfo
    if (isImportItem(container) || isNamedTypeItem(container)) {
      if (container.previous?.entity.error) {
        // Previous is broken; we don't need more errors here
        return createSyntheticAstNodeDescription(refInfo.reference.$refText, { $type: 'Unknown' })
      }
    }

    return this.createLinkingError(refInfo)
  }

  override getCandidates(refInfo: ReferenceInfo): AstNodeDescription[] | LinkingError {
    // TODO: multi reference
    return this.createLinkingError(refInfo)
  }
}
