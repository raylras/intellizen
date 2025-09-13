import type { AstNodeDescription, LinkingError, ReferenceInfo } from 'langium'
import type { ImportItem, NamedTypeItem } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import { DefaultLinker } from 'langium'
import { isImportDeclaration, isImportItem, isNamedTypeItem } from '../generated/ast'
import { createSyntheticAstNodeDescription } from './synthetic'

export class ZenScriptLinker extends DefaultLinker {
  constructor(services: ZenScriptServices) {
    super(services)
  }

  override getCandidate(info: ReferenceInfo): AstNodeDescription | LinkingError {
    const scope = this.scopeProvider.getScope(info)
    const description = scope.getElement(info.reference.$refText)
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
        return createSyntheticAstNodeDescription(info.reference.$refText, { $type: 'Unknown' })
      }
    }

    return this.createLinkingError(info)
  }

  override getCandidates(refInfo: ReferenceInfo): AstNodeDescription[] | LinkingError {
    // TODO: multi reference
    return this.createLinkingError(refInfo)
  }
}
