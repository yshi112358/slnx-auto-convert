# SLNX auto-convert

Visual Studio / Unity が生成する `.slnx` を、VS Code / Cursor 上で従来の `.sln` に変換し、`.slnx` を削除、`dotnet.defaultSolution` を更新する拡張機能です。変換は拡張内の TypeScript で行い、Python は不要です。

## ビルドと VSIX

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

## インストール

VSIX を **Install from VSIX** で読み込んでください。
