# Archestra App - Project Overview

## Purpose
This is a Tauri-based desktop application that provides AI and LLM connectivity features, including:
- Integration with various LLM providers (Ollama)
- MCP (Model Context Protocol) server management with sandboxing
- AI connector services for desktop applications

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Desktop Framework**: Tauri v2 (Rust)
- **Backend Services**: Node.js Express sidecar server
- **Package Manager**: pnpm 10.6.5
- **Bundler**: Vite 6.0.3
- **Build Tools**: TypeScript 5.6.2

## Key Features
- Running LLM models locally via Ollama integration
- MCP server execution in sandboxed environment
- Chat interface for AI interactions
- Sidecar server architecture for additional services