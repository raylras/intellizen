import type { AstNode, LangiumDocument, NameProvider } from 'langium'
import type { ZenScriptServices } from '../module'
import type { NamespaceNode } from '../utils/namespace-tree'
import { AstUtils, DocumentState, stream } from 'langium'
import { isClassDeclaration } from '../generated/ast'
import { isExposed, isStatic } from '../utils/ast'
import { NamespaceTree } from '../utils/namespace-tree'

export interface PackageManager {
  find: (path: string) => ReadonlySet<AstNode>
  findNode: (path: string) => NamespaceNode<AstNode> | undefined
  root: NamespaceNode<AstNode>
}

export class ZenScriptPackageManager implements PackageManager {
  private readonly packages: NamespaceTree<AstNode> = new NamespaceTree('.')
  private readonly nameProvider: NameProvider

  constructor(services: ZenScriptServices) {
    this.nameProvider = services.references.NameProvider

    // insert data once document is indexed content
    services.shared.workspace.DocumentBuilder.onDocumentPhase(DocumentState.IndexedContent, (document) => {
      this.processExposedNodes(document, node => this.insertNode(node))
    })

    // remove data once document is changed or deleted
    services.shared.workspace.DocumentBuilder.onUpdate((changed, deleted) => {
      stream(changed, deleted)
        .map(it => services.shared.workspace.LangiumDocuments.getDocument(it))
        .nonNullable()
        .forEach((document) => {
          this.processExposedNodes(document, node => this.removeNode(node))
        })
    })
  }

  find(path: string): ReadonlySet<AstNode> {
    return this.packages.find(path)
  }

  findNode(path: string): NamespaceNode<AstNode> | undefined {
    return this.packages.findNode(path)
  }

  get root(): NamespaceNode<AstNode> {
    return this.packages.root
  }

  private processExposedNodes(document: LangiumDocument, processor: (node: AstNode) => void) {
    const root = document.parseResult.value
    const toplevels = AstUtils.streamContents(root).filter(isExposed)
    for (const toplevel of toplevels) {
      processor(toplevel)
      if (isClassDeclaration(toplevel)) {
        for (const member of toplevel.members.filter(isStatic)) {
          processor(member)
        }
      }
    }
  }

  private insertNode(node: AstNode) {
    const name = this.nameProvider.getQualifiedName(node)
    if (name) {
      this.packages.insert(name, node)
    }
  }

  private removeNode(node: AstNode) {
    const name = this.nameProvider.getQualifiedName(node)
    if (name) {
      this.packages.findNode(name)?.delete(node)
    }
  }
}
