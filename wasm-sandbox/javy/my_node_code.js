function sum(a, b) {
  return a + b;
}

// Javy expects a main entry point for WASM. We'll use stdin/stdout for communication.
function readInput() {
  const chunkSize = 1024;
  const inputChunks = [];
  let totalBytes = 0;
  while (1) {
    const buffer = new Uint8Array(chunkSize);
    const fd = 0;
    const bytesRead = Javy.IO.readSync(fd, buffer);
    totalBytes += bytesRead;
    if (bytesRead === 0) {
      break;
    }
    inputChunks.push(buffer.subarray(0, bytesRead));
  }
  const { finalBuffer } = inputChunks.reduce((context, chunk) => {
    context.finalBuffer.set(chunk, context.bufferOffset);
    context.bufferOffset += chunk.length;
    return context;
  }, { bufferOffset: 0, finalBuffer: new Uint8Array(totalBytes) });
  return JSON.parse(new TextDecoder().decode(finalBuffer));
}

function writeOutput(output) {
  const encodedOutput = new TextEncoder().encode(JSON.stringify(output));
  const buffer = new Uint8Array(encodedOutput);
  const fd = 1;
  Javy.IO.writeSync(fd, buffer);
}

const input = readInput();
const result = sum(input.a, input.b);
writeOutput({ result }); 
