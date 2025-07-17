# Code Style and Conventions

## TypeScript/React Conventions
- **TypeScript**: Strict mode enabled with noUnusedLocals and noUnusedParameters
- **React**: Using React 18 with functional components and hooks
- **Module System**: ES modules ("type": "module")
- **JSX**: Using react-jsx transform
- **State Management**: React hooks (useState, useEffect)

## TypeScript Config
- Target: ES2020
- Module Resolution: bundler mode
- Strict type checking enabled
- No implicit any
- No unused locals/parameters
- No fallthrough cases in switch

## File Structure
- `/src` - React frontend code
- `/src-tauri` - Rust Tauri backend
- `/backend` - Node.js backend services (organized by feature)
- `/sidecar-server` - Express.js sidecar server

## Naming Conventions
- Components: PascalCase (e.g., `App.tsx`)
- Functions: camelCase (e.g., `greetingFromNodeSidecarServer`)
- State variables: camelCase with descriptive names
- Async functions: Properly typed with async/await pattern

## Import Style
- Named imports for utilities and hooks
- Default exports for components
- Absolute imports not configured (using relative paths)