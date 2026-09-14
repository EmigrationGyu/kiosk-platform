export const extractData = (buf: Buffer) => {
  if (buf.length < 5) {
    throw new Error('Invalid buffer length');
  }

  const stx = buf[0];
  const addr = buf.subarray(1, 3);
  const length = ((buf[3] ?? 0) << 8) | (buf[4] ?? 0);

  const expectedLength = 5 + length + 2;
  if (buf.length < expectedLength) {
    throw new Error('Buffer too short for declared length');
  }

  const data = buf.subarray(5, 5 + length);
  const etx = buf[5 + length];
  const bcc = buf[5 + length + 1];
  const checksum = generateBCC(buf.subarray(0, buf.length - 1));

  if (stx !== 0x02) {
    throw new Error('Invalid STX');
  }

  if (etx !== 0x03) {
    throw new Error('Invalid ETX');
  }

  if (bcc !== checksum) {
    throw new Error('Invalid checksum');
  }

  return data;
};

export const generateBCC = (buf: Buffer) => {
  return buf.reduce((acc, curr) => acc ^ curr, 0);
};
