import type { AstNode, AstNodeDescription, LangiumDocument, MultiMap } from 'langium'
import type { Script } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import { DefaultScopeComputation } from 'langium'
import { isExpandDeclaration, isExpandFunctionDeclaration } from '../generated/ast'
import { isGlobal } from '../utils/ast'

export class ZenScriptScopeComputation extends DefaultScopeComputation {
  constructor(services: ZenScriptServices) {
    super(services)
  }

  override addExportedSymbol(node: AstNode, exports: AstNodeDescription[], document: LangiumDocument<Script>): void {
    if (isGlobal(node)) {
      const name = this.nameProvider.getName(node)
      if (name) {
        exports.push(this.descriptions.getOrCreateDescription(node, name, document.uri))
      }
    }
    else if (isExpandFunctionDeclaration(node) && node.name) {
      exports.push(this.descriptions.getOrCreateDescription(node, node.name, document.uri))
    }
    else if (isExpandDeclaration(node) && node.type) {
      exports.push(this.descriptions.getOrCreateDescription(node, node.type.$cstNode?.text ?? '', document.uri))
    }
  }

  override addLocalSymbol(node: AstNode, document: LangiumDocument, symbols: MultiMap<AstNode, AstNodeDescription>): void {
    const name = this.nameProvider.getName(node)
    if (name) {
      symbols.add(node, this.descriptions.getOrCreateDescription(node, name, document.uri))
    }
  }
}
