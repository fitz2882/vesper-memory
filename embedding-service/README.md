# BGE-Large Embedding Service

REST API for generating 1024-dimensional semantic embeddings using BGE-large-en-v1.5.

## Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Start server
python server.py
```

The service will start on `http://localhost:8000`

## API Endpoints

### Health Check
```bash
curl http://localhost:8000/health
```

### Single/Multiple Embeddings
```bash
curl -X POST http://localhost:8000/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'

# Multiple texts
curl -X POST http://localhost:8000/embed \
  -H "Content-Type: application/json" \
  -d '{"text": ["Hello", "World"]}'
```

### Batch Processing
```bash
curl -X POST http://localhost:8000/embed/batch \
  -H "Content-Type: application/json" \
  -d '{
    "texts": ["text1", "text2", "text3"],
    "batch_size": 32
  }'
```

## Integration

From TypeScript/Node.js:

```typescript
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('http://localhost:8000/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  const data = await response.json();
  return data.embeddings[0];
}
```

## Performance

- **Model**: BAAI/bge-large-en-v1.5
- **Dimensions**: 1024
- **Throughput**: ~100-200 embeddings/sec (CPU), ~1000+/sec (GPU)
- **Latency**: ~10-50ms per text (CPU), ~1-5ms (GPU)

## Credits

This service uses [BAAI/bge-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5), an open-source embedding model developed by the Beijing Academy of Artificial Intelligence (BAAI).

**Model Repository**: [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding)

BGE (BAAI General Embedding) models are trained using RetroMAE and contrastive learning on large-scale pairs data, achieving state-of-the-art performance on semantic retrieval tasks.
