import type { Topic } from '@levelhead/contracts'

export const ML_TOPICS: readonly Topic[] = [
  {
    id: 'ml.bias_variance',
    area: 'ml',
    title: 'Bias–variance and overfitting',
    ask: 'Ask them to explain overfitting through the bias–variance trade-off and how they would detect and reduce it.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'bias is error from overly simple assumptions; variance is sensitivity to the particular training set',
        'overfitting shows as low training error with much higher validation error',
        'model complexity moves the error along the bias–variance trade-off',
      ],
      trade_offs: [
        'regularisation such as L1 or L2 lowers variance at the cost of some bias',
        'more training data lowers variance but costs collection and labelling effort',
        'a simpler model generalises more reliably but may underfit',
      ],
      failure_modes: [
        'tuning on the test set leaks it and hides overfitting',
        'data leakage makes validation scores far better than production',
        'a validation split that does not match the production distribution',
      ],
    },
    falsePremise:
      'If training accuracy is 99%, the model will do about as well on new data, so a validation set is unnecessary.',
    twist: 'you only have 500 labelled examples and 10,000 features',
  },
  {
    id: 'ml.precision_recall',
    area: 'ml',
    title: 'Precision and recall',
    ask: 'Ask them to explain precision and recall and which one they would optimise for a specific classifier.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'precision is TP / (TP + FP): of the predicted positives, how many are right',
        'recall is TP / (TP + FN): of the actual positives, how many were found',
        'moving the decision threshold trades one against the other',
      ],
      trade_offs: [
        'favour recall when a miss is costly, such as disease screening',
        'favour precision when a false alarm is costly, such as a spam filter',
        'F1 combines both but hides which one is weak',
      ],
      failure_modes: [
        'accuracy looks high on imbalanced data while recall is near zero',
        'choosing the threshold on the test set',
        'the class balance in production drifting away from the evaluation data',
      ],
    },
    falsePremise:
      'On a dataset where 1% of transactions are fraud, 99% accuracy means the model is catching almost all of the fraud.',
    twist: 'the positive class is 1 in 10,000 and every alert is reviewed by a human',
  },
  {
    id: 'ml.gradient_descent',
    area: 'ml',
    title: 'Gradient descent',
    ask: 'Ask them to explain how gradient descent trains a model, and how they would choose the learning rate and the batch size.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'compute the gradient of the loss with respect to each parameter and step against it',
        'the learning rate scales the size of each step',
        'batch, stochastic and mini-batch variants differ in how many examples each gradient is computed from',
        'backpropagation computes the gradients layer by layer with the chain rule',
      ],
      trade_offs: [
        'a large learning rate moves faster but can overshoot or diverge; a small one is slow',
        'small batches give noisy gradients that can escape poor regions but use the hardware less efficiently',
        'adaptive optimisers such as Adam need less learning-rate tuning but keep two extra values per parameter in memory',
      ],
      failure_modes: [
        'a learning rate that is too high sending the loss to NaN',
        'vanishing or exploding gradients in deep networks',
        'features on very different scales slowing convergence',
      ],
    },
    falsePremise:
      'Gradient descent always finds the global minimum of the loss, as long as it runs for enough epochs.',
    twist: 'the loss falls for a few epochs and then suddenly jumps to NaN',
  },
  {
    id: 'ml.transformers_attention',
    area: 'ml',
    title: 'Transformers and attention',
    ask: 'Ask them to explain how self-attention works in a transformer, and why transformers replaced recurrent networks for language.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'each token is projected into a query, a key and a value',
        'attention weights are the softmax of query-key dot products scaled by the square root of the key dimension, and the output is the weighted sum of the values',
        'several heads attend in parallel, and positional encodings supply the word order attention lacks',
        'decoder models use a causal mask so each token attends only to earlier tokens',
      ],
      trade_offs: [
        'attention processes all tokens of a sequence in parallel, where an RNN steps through them one at a time',
        'full self-attention costs O(n²) time and memory in the sequence length',
        'a longer context window sees more text but costs more compute and memory per request',
      ],
      failure_modes: [
        'input longer than the context window getting truncated',
        'missing position information making the model blind to word order',
        'the key-value cache for long contexts exhausting GPU memory at inference',
      ],
    },
    falsePremise:
      'The cost of self-attention grows linearly with the sequence length, which is why transformers handle long documents more cheaply than RNNs.',
    twist:
      'the model must now answer questions about 500-page contracts that do not fit in its context window',
  },
  {
    id: 'ml.rag',
    area: 'ml',
    title: 'Retrieval-augmented generation',
    ask: 'Ask them to explain how a retrieval-augmented generation system answers questions from a document collection, and how they would evaluate it.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'documents are split into chunks, embedded as vectors and stored in an index',
        'the question is embedded and the nearest chunks are retrieved by similarity, often combined with keyword search',
        'the retrieved chunks go into the prompt so the model answers from them and can cite them',
        'retrieval (did the right chunk come back) is evaluated separately from generation (is the answer faithful to it)',
      ],
      trade_offs: [
        'small chunks retrieve precisely but lose surrounding context; large chunks do the reverse',
        'retrieving more chunks raises recall but costs tokens and can distract the model',
        'a re-ranker improves the top results at the cost of latency',
      ],
      failure_modes: [
        'the right passage never being retrieved, so the model answers from memory or makes something up',
        'instructions hidden in a retrieved document hijacking the model (prompt injection)',
        'a stale index answering from outdated documents',
      ],
    },
    falsePremise:
      'Once the right documents are in the prompt, the model cannot hallucinate, so a RAG system never needs its answers checked.',
    twist:
      'the documents are internal policies that change weekly, and some employees must not see some of them',
  },
]
