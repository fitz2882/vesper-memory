# Brief-mode evaluation on LoCoMo

Generated: 2026-11-16T05:15:21.251Z

Data: LoCoMo-10, 10 conversations, 5882 turns stored as memories. Skipped 5 questions whose evidence ids are not in the data (5 unmatched ids); category 5 (adversarial) excluded.
Conversations: all.
Retrieval: production MemoryRetriever, pool of 80 candidates. Retrieval + packing P50/P95: 12.2 / 18.9 ms.

## full_text

### all (n=1535)

| Arm | Evidence recall | All evidence | Answer present | Avg tokens |
|---|---|---|---|---|
| top5 | 34.7% | 41.6% | 28.6% (n=1278) | 199 |
| whole@300 | 38.5% | 45.3% | 31.7% (n=1278) | 286 |
| brief@300 | 38.5% | 45.3% | 31.7% (n=1278) | 286 |
| whole@600 | 45.3% | 51.3% | 37.6% (n=1278) | 577 |
| brief@600 | 45.3% | 51.3% | 37.6% (n=1278) | 577 |
| whole@1200 | 53.1% | 57.8% | 42.6% (n=1278) | 1160 |
| brief@1200 | 53.1% | 57.8% | 42.6% (n=1278) | 1160 |

### multi-hop (n=282)

| Arm | Evidence recall | All evidence | Answer present | Avg tokens |
|---|---|---|---|---|
| top5 | 13.6% | 3.9% | 9.5% (n=201) | 193 |
| whole@300 | 16.9% | 5.3% | 11.9% (n=201) | 286 |
| brief@300 | 16.9% | 5.3% | 11.9% (n=201) | 286 |
| whole@600 | 24.5% | 8.2% | 19.4% (n=201) | 577 |
| brief@600 | 24.5% | 8.2% | 19.4% (n=201) | 577 |
| whole@1200 | 33.8% | 14.2% | 26.9% (n=201) | 1160 |
| brief@1200 | 33.8% | 14.2% | 26.9% (n=201) | 1160 |

### single-hop (n=841)

| Arm | Evidence recall | All evidence | Answer present | Avg tokens |
|---|---|---|---|---|
| top5 | 54.0% | 53.6% | 46.6% (n=695) | 201 |
| whole@300 | 58.3% | 57.8% | 50.9% (n=695) | 286 |
| brief@300 | 58.3% | 57.8% | 50.9% (n=695) | 286 |
| whole@600 | 65.8% | 65.8% | 58.7% (n=695) | 577 |
| brief@600 | 65.8% | 65.8% | 58.7% (n=695) | 577 |
| whole@1200 | 72.0% | 71.9% | 64.6% (n=695) | 1160 |
| brief@1200 | 72.0% | 71.9% | 64.6% (n=695) | 1160 |

### temporal (n=320)

| Arm | Evidence recall | All evidence | Answer present | Avg tokens |
|---|---|---|---|---|
| top5 | 50.5% | 51.3% | 6.6% (n=319) | 199 |
| whole@300 | 55.3% | 55.6% | 7.5% (n=319) | 286 |
| brief@300 | 55.3% | 55.6% | 7.5% (n=319) | 286 |
| whole@600 | 59.9% | 60.0% | 8.5% (n=319) | 577 |
| brief@600 | 59.9% | 60.0% | 8.5% (n=319) | 577 |
| whole@1200 | 68.7% | 69.1% | 10.7% (n=319) | 1160 |
| brief@1200 | 68.7% | 69.1% | 10.7% (n=319) | 1160 |

### open-domain (n=92)

| Arm | Evidence recall | All evidence | Answer present | Avg tokens |
|---|---|---|---|---|
| top5 | 13.0% | 14.1% | 1.6% (n=63) | 188 |
| whole@300 | 14.9% | 17.4% | 4.8% (n=63) | 286 |
| brief@300 | 14.9% | 17.4% | 4.8% (n=63) | 286 |
| whole@600 | 19.2% | 20.7% | 9.5% (n=63) | 577 |
| brief@600 | 19.2% | 20.7% | 9.5% (n=63) | 577 |
| whole@1200 | 25.5% | 22.8% | 11.1% (n=63) | 1159 |
| brief@1200 | 25.5% | 22.8% | 11.1% (n=63) | 1159 |

