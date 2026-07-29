export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  assertSampleRate(sourceRate, 'sourceRate');
  assertSampleRate(targetRate, 'targetRate');
  if (input.length === 0) return new Float32Array();
  if (sourceRate === targetRate) return input.slice();

  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  if (input.length === 1) {
    output.fill(input[0] ?? 0);
    return output;
  }

  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index++) {
    const position = Math.min(index * ratio, input.length - 1);
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    const leftValue = input[left] ?? 0;
    output[index] = leftValue + ((input[right] ?? leftValue) - leftValue) * fraction;
  }
  return output;
}

function assertSampleRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}
