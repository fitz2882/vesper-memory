# Contributing to Vesper

Thank you for your interest in contributing! This project aims to provide a production-ready memory system for AI agents using the Model Context Protocol (MCP).

## Getting Started

### Prerequisites
- Node.js 20+
- Docker and Docker Compose
- Git

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/fitz2882/vesper-memory.git
cd vesper-memory

# Install dependencies
npm install

# Start infrastructure services
docker-compose up -d

# Run tests
npm test

# Build TypeScript
npm run build
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Changes

- Write tests first (TDD approach preferred)
- Keep changes focused and atomic
- Follow existing code style
- Add JSDoc comments for public APIs

### 3. Run Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test tests/your-test.test.ts

# Run with coverage
npm test -- --coverage

# Lint code
npm run lint

# Format code
npm run format
```

### 4. Commit Guidelines

Use conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `chore`: Build process or auxiliary tool changes

**Examples:**
```bash
git commit -m "feat(semantic): add temporal decay to relationships"
git commit -m "fix(router): handle empty query strings gracefully"
git commit -m "docs(readme): add BGE embedding setup instructions"
```

### 5. Submit Pull Request

- Push your branch to GitHub
- Open a Pull Request against `main`
- Fill out the PR template
- Link related issues
- Wait for review

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer interfaces over types for objects
- Use explicit return types for functions
- Avoid `any` - use `unknown` if needed

**Example:**
```typescript
interface MemoryEntry {
  id: string;
  content: string;
  timestamp: Date;
}

async function storeMemory(entry: MemoryEntry): Promise<void> {
  // Implementation
}
```

### Testing

- Aim for 80%+ coverage
- Test edge cases and error paths
- Use descriptive test names
- Mock external dependencies

**Example:**
```typescript
describe("SemanticMemoryLayer", () => {
  it("should retrieve entities within date range", () => {
    // Given
    const startDate = new Date("2026-01-01");
    const endDate = new Date("2026-01-31");

    // When
    const results = semantic.getByTimeRange(startDate, endDate);

    // Then
    expect(results.length).toBeGreaterThan(0);
  });
});
```

## Project Structure

```
vesper/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── memory-layers/         # Memory system implementations
│   │   ├── working-memory.ts  # Redis-backed short-term memory
│   │   ├── semantic-memory.ts # SQLite knowledge graph
│   │   └── skill-library.ts   # Procedural knowledge
│   ├── router/                # Query routing and classification
│   ├── synthesis/             # Conflict detection and resolution
│   ├── consolidation/         # Background memory consolidation
│   ├── middleware/            # Auth, rate limiting
│   └── monitoring/            # Metrics and health checks
├── tests/                     # Test files
├── config/                    # Configuration files
│   ├── sqlite-schema.sql      # Database schema
│   └── nginx/                 # HTTPS configuration
└── embedding-service/         # BGE-large Python service
```

## Areas for Contribution

### High Priority
- [ ] Improve retrieval accuracy (currently 92%, target 95%+)
- [ ] Optimize consolidation pipeline performance
- [ ] Add sparse/BM25 indexes for hybrid search
- [ ] Improve conflict resolution strategies

### Features
- [ ] Multi-user support with isolated memory spaces
- [ ] Export/import memory graphs
- [ ] Memory visualization dashboard
- [ ] Plugin system for custom memory layers
- [ ] Scheduled memory reviews

### Documentation
- [ ] Video tutorials
- [ ] Architecture deep-dive
- [ ] Production deployment guide
- [ ] Troubleshooting guide
- [ ] API reference

### Testing
- [ ] Load testing suite
- [ ] Security testing
- [ ] Cross-platform compatibility tests
- [ ] Integration test scenarios

## Questions?

- **Documentation**: Check [README.md](README.md) and [CLAUDE.md](CLAUDE.md)
- **Issues**: [GitHub Issues](https://github.com/fitz2882/vesper-memory/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fitz2882/vesper-memory/discussions)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for helping make memory systems better for AI agents! 🚀**
