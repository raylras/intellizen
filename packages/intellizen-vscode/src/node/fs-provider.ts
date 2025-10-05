import { Buffer } from 'node:buffer'
import { getBuiltins } from 'intellizen-zenscript'
import * as vscode from 'vscode'

export class DzsBuiltinFileSystemProvider implements vscode.FileSystemProvider {
  static register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider('builtin', new DzsBuiltinFileSystemProvider(), {
        isReadonly: true,
        isCaseSensitive: false,
      }),
    )
  }

  private readonly builtins: Map<string, string> = new Map()

  constructor() {
    const builtins = getBuiltins()
    for (const { uri, content } of builtins) {
      this.builtins.set(uri.path, content)
    }
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const file = this.builtins.get(uri.path)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    const date = Date.now()
    return {
      ctime: date,
      mtime: date,
      size: Buffer.from(file).length,
      type: vscode.FileType.File,
    }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const file = this.builtins.get(uri.path)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return Buffer.from(file)
  }

  // The following class members only serve to satisfy the interface

  private readonly didChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile = this.didChangeFile.event

  watch() {
    return {
      dispose: () => {},
    }
  }

  readDirectory(uri: vscode.Uri): [] {
    throw vscode.FileSystemError.FileNotFound(uri)
  }

  createDirectory() {
    throw vscode.FileSystemError.NoPermissions()
  }

  writeFile() {
    throw vscode.FileSystemError.NoPermissions()
  }

  delete() {
    throw vscode.FileSystemError.NoPermissions()
  }

  rename() {
    throw vscode.FileSystemError.NoPermissions()
  }
}
