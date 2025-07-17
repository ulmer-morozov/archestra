# Task Completion Checklist

When completing a coding task in this project, ensure:

## 1. Type Safety
- Run `pnpm build` to ensure TypeScript compilation passes
- Fix any type errors before considering task complete

## 2. Testing
- No testing framework is currently set up
- Manual testing through `pnpm tauri dev` is required

## 3. Code Quality
- No linting configuration found (ESLint not set up)
- Follow TypeScript strict mode requirements
- Ensure no unused variables or parameters

## 4. Pre-commit
- Verify changes work in development mode
- Test both frontend (`pnpm dev`) and full app (`pnpm tauri dev`)

## 5. Documentation
- Update code comments if making significant changes
- Keep component interfaces clear and typed

Note: The project currently lacks automated linting, formatting, and testing tools. Consider suggesting these improvements if working on code quality tasks.