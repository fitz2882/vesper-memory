# Security Policy

Vesper is a local-first MCP server. It runs over stdio, stores data under `~/.vesper/`, and the bundled Docker Compose stack binds Redis, Qdrant and the embedding service to `127.0.0.1` only. It is not designed to be exposed to a network.

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainer (see `package.json`) or use GitHub's private vulnerability reporting on this repository. You should get an acknowledgement within a few days.

## Scope

In scope: anything that lets another local process or a stored memory escalate privileges, read data from another namespace, or execute code through the MCP tools.

Out of scope: running the Compose stack on a public interface, or reusing the development configuration in production.
