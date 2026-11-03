#!/usr/bin/env python3
"""
BGE-Large Embedding Service - v3.0

Simple REST API for generating embeddings using BGE-large-en-v1.5.
Returns 1024-dimensional dense vectors for semantic search.
"""

from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import numpy as np

app = Flask(__name__)

# Load BGE-large model (1024-dim embeddings)
print("Loading BGE-large-en-v1.5 model...")
model = SentenceTransformer('BAAI/bge-large-en-v1.5')
print("Model loaded successfully!")

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "model": "BGE-large-en-v1.5", "dimensions": 1024})

@app.route('/embed', methods=['POST'])
def embed():
    """
    Generate embeddings for text

    Request:
    {
        "text": "string" or ["array", "of", "strings"],
        "normalize": true  # optional, default true
    }

    Response:
    {
        "embeddings": [[...], [...]],
        "dimensions": 1024,
        "count": 2
    }
    """
    try:
        data = request.json
        text = data.get('text')
        normalize = data.get('normalize', True)

        if not text:
            return jsonify({"error": "Missing 'text' field"}), 400

        # Convert single string to list
        if isinstance(text, str):
            text = [text]

        # Generate embeddings
        embeddings = model.encode(
            text,
            normalize_embeddings=normalize,
            show_progress_bar=False
        )

        # Convert to list for JSON serialization
        embeddings_list = embeddings.tolist()

        return jsonify({
            "embeddings": embeddings_list,
            "dimensions": 1024,
            "count": len(embeddings_list)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/embed/batch', methods=['POST'])
def embed_batch():
    """
    Batch embedding endpoint with better performance

    Request:
    {
        "texts": ["text1", "text2", ...],
        "batch_size": 32  # optional
    }
    """
    try:
        data = request.json
        texts = data.get('texts')
        batch_size = data.get('batch_size', 32)

        if not texts or not isinstance(texts, list):
            return jsonify({"error": "Missing or invalid 'texts' field"}), 400

        embeddings = model.encode(
            texts,
            batch_size=batch_size,
            normalize_embeddings=True,
            show_progress_bar=False
        )

        return jsonify({
            "embeddings": embeddings.tolist(),
            "dimensions": 1024,
            "count": len(embeddings)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=False)
