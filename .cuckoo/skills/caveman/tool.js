/**
 * Caveman Skill - tool.js
 * Compress text to caveman style
 */

function compressText(args) {
  const text = (args && args.text) || '';
  if (!text) return { compressed: '', savedTokens: 0 };

  const originalTokens = text.split(/\s+/).length;

  // Drop filler words
  let compressed = text
    .replace(/\b(a|an|the)\b/gi, '')
    .replace(/\b(just|really|basically|actually|simply|certainly|of course|happy to|sure)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const compressedTokens = compressed.split(/\s+/).length;
  const savedTokens = originalTokens - compressedTokens;

  return {
    original: text,
    compressed: compressed,
    originalTokens: originalTokens,
    compressedTokens: compressedTokens,
    savedTokens: savedTokens,
    compressionRatio: ((savedTokens / originalTokens) * 100).toFixed(1) + '%',
  };
}

function estimateSavings(args) {
  const text = (args && args.text) || '';
  const result = compressText({ text });
  return {
    originalTokens: result.originalTokens,
    estimatedSavings: result.savedTokens,
    ratio: result.compressionRatio,
  };
}

module.exports = { compressText, estimateSavings };
