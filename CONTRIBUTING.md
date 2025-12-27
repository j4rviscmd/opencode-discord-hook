# Contributing Guide

Thank you for considering contributing to this project! This document outlines the guidelines and workflow for contributing.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Coding Standards](#coding-standards)
5. [Commit Message Guidelines](#commit-message-guidelines)
6. [Pull Request Process](#pull-request-process)
7. [Issue Reporting](#issue-reporting)

---

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming and inclusive community.

---

## Getting Started

### Prerequisites

<!-- Customize this section for each project -->
- Node.js 18+ / Python 3.10+ / Go 1.21+ (depending on the project)
- Git
- [Additional dependencies specific to your project]

### Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd <project-name>

# Install dependencies
npm install  # or pip install -r requirements.txt, etc.

# Run tests
npm test     # or pytest, go test, etc.
```

---

## Development Workflow

We follow **GitHub Flow** for a simple and efficient workflow:

1. **Fork and clone** the repository
2. **Create a feature branch** from `main`
3. **Implement your changes** with clear, focused commits
4. **Push to your fork** and create a Pull Request
5. **Address review feedback** if needed
6. **Merge** after approval

### Branch Naming Convention

Use the following format:

```
<type>/<short-description>
```

**Types:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `chore/` - Maintenance tasks, dependency updates
- `refactor/` - Code refactoring

**Examples:**
```
feature/add-user-authentication
fix/memory-leak-issue
docs/update-readme
chore/update-dependencies
```

---

## Coding Standards

### General Principles

- Follow **best practices** for security, performance, readability, maintainability, and testability
- Write **self-documenting code** with clear variable and function names
- Add **comments** for complex logic
- Ensure **error handling** is appropriate and informative

### Language-Specific Guidelines

#### TypeScript/JavaScript
- **Indentation**: 2 spaces
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Formatter**: Prettier
- **Documentation**: JSDoc for functions and classes

#### Python
- **Indentation**: 4 spaces (PEP 8)
- **Naming**: snake_case for variables/functions, PascalCase for classes
- **Formatter**: ruff or black
- **Documentation**: Docstrings for functions and classes

#### Go
- **Indentation**: Tabs
- **Naming**: camelCase (PascalCase for exported items)
- **Formatter**: gofmt
- **Documentation**: godoc format

### Code Quality Standards

- **Line Length**: Maximum 80 characters
- **Testing**:
  - Write unit tests for new features
  - Aim for 70%+ code coverage (100% preferred)
  - Include integration tests for critical features
- **Error Handling**:
  - Handle all async operations properly
  - Provide specific, debugging-friendly error messages
- **Logging**:
  - Log important operations (start/end)
  - Include detailed stack traces for errors
  - Never log sensitive information (passwords, tokens, PII)

---

## Commit Message Guidelines

We follow **Conventional Commits** format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Commit Types

| Type       | Description                                    |
|------------|------------------------------------------------|
| `feat`     | New feature                                    |
| `fix`      | Bug fix                                        |
| `docs`     | Documentation changes only                     |
| `style`    | Code formatting (no functional changes)        |
| `refactor` | Code refactoring (no functional changes)       |
| `test`     | Adding or updating tests                       |
| `chore`    | Build process, dependency updates, configs     |
| `perf`     | Performance improvements                       |
| `ci`       | CI/CD configuration changes                    |
| `revert`   | Reverting a previous commit                    |

### Scope (Optional)

Indicates the area of change (e.g., `auth`, `api`, `ui`, `docs`)

### Subject

- Use **imperative mood** ("add feature" not "added feature")
- Keep it **under 50 characters**
- **No period** at the end
- Be **concise and descriptive**

### Examples

```bash
feat(auth): add OAuth2 authentication support
fix(api): resolve memory leak in request handler
docs(readme): update installation instructions
chore(deps): update dependencies to latest versions
test(auth): add unit tests for login flow
```

### Detailed Commit Message

For complex changes, include a body:

```
feat(api): add rate limiting middleware

Implement rate limiting to prevent API abuse:
- 100 requests per minute per IP
- Configurable via environment variables
- Returns 429 status when limit exceeded

Refs #42
```

---

## Pull Request Process

### Before Creating a PR

1. **Update your branch** with the latest `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout your-branch
   git merge main
   ```

2. **Run tests** and ensure they pass:
   ```bash
   npm test  # or equivalent for your project
   ```

3. **Review your changes**:
   ```bash
   git diff main
   ```

### Creating a Pull Request

1. **Push your branch** to your fork:
   ```bash
   git push -u origin your-branch
   ```

2. **Create a PR** on GitHub with a clear title and description

3. **Use the PR template** (automatically populated)

4. **Link related issues** (e.g., "Closes #123")

### PR Review Checklist

Use our [Pull Request Template](.github/pull_request_template.md) which includes:

- [ ] Code follows project style guidelines
- [ ] Error handling is appropriate
- [ ] No sensitive information in code or logs
- [ ] Comments are clear and helpful
- [ ] Commit messages follow Conventional Commits
- [ ] Commits are focused (one concern per commit)
- [ ] No unnecessary files committed
- [ ] Tests pass locally
- [ ] Documentation updated if needed
- [ ] No conflicts with main branch

### Review Process

- All PRs require review before merging
- Address feedback promptly
- Keep discussions respectful and constructive
- Squash commits if needed for cleaner history

---

## Issue Reporting

### Before Creating an Issue

- **Search existing issues** to avoid duplicates
- **Check documentation** for known solutions
- **Use the latest version** when possible

### Creating an Issue

We provide issue templates for common scenarios:

#### Feature Request

Use [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md) to:
- Describe the feature
- Explain the motivation
- Propose a solution
- Discuss alternatives

#### Bug Report

Use [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) to:
- Describe the bug
- Provide reproduction steps
- Include error messages/logs
- Specify environment details

### Issue Labels

Common labels used:
- `bug` - Something isn't working
- `enhancement` - New feature or improvement
- `documentation` - Documentation updates
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

---

## Additional Resources

- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [How to Write a Good Commit Message](https://chris.beams.io/posts/git-commit/)

---

## Questions?

If you have questions not covered in this guide, feel free to:
- Open a discussion in GitHub Discussions
- Ask in existing issues
- Contact the maintainers

Thank you for contributing! 🎉
