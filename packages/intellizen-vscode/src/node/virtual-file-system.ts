import { Buffer } from 'node:buffer'
import { builtinsFileMap } from 'intellizen-zenscript'
import * as vscode from 'vscode'
import { Utils } from 'vscode-uri'

export class BuiltinFileSystemProvider implements vscode.FileSystemProvider {
  static register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        'builtin',
        new BuiltinFileSystemProvider(),
        { isReadonly: true, isCaseSensitive: true },
      ),
    )
  }

  private readonly entries: [string, vscode.FileType.File][]

  constructor() {
    this.entries = builtinsFileMap.keys().map<[string, vscode.FileType.File]>(filename => [filename, vscode.FileType.File]).toArray()
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const date = Date.now()
    if (uri.path === '/') {
      return {
        ctime: date,
        mtime: date,
        size: 0,
        type: vscode.FileType.Directory,
      }
    }
    const text = builtinsFileMap.get(Utils.basename((uri)))
    if (!text) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return {
      ctime: date,
      mtime: date,
      size: text.length,
      type: vscode.FileType.File,
    }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const text = builtinsFileMap.get(Utils.basename((uri)))
    if (!text) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return Buffer.from(text)
  }

  // The following class members only serve to satisfy the interface

  private readonly didChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile = this.didChangeFile.event

  watch() {
    return {
      dispose: () => {},
    }
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    if (uri.path === '/') {
      return this.entries
    }
    throw vscode.FileSystemError.NoPermissions()
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
