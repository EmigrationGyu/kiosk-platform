// 이 파일은 `bun run contract` 가 생성합니다. 직접 수정하지 마세요.
// 계약 지문의 정의는 src/contract/{registry,canonical,hash}.ts 에 있습니다.

export const CONTRACT = {
  algorithm: 'sha256',
  namespaces: {
    '/filesystem':
      'd4dedb8f94a856b6b0ffb6182087c478073ef34f3c3a42b6fd10787242db57db',
    '/hardware':
      '76170da0f33048087e3a1acdd6f95ecf0a8694ce9e1d42b725322b6e4e761557',
    '/ime': 'c11ed3c9c36304d3a9973e227b9a9db21bcfe5ddff1b6d1975c13716aae5c29e',
    '/log': 'f0e648bf5a156f9b0adb412928a29b8f224460192ee4adcb1582d3946b6c71fa',
    '/outbox':
      '5827ea60f9c1d644b472c7348d029b33aed035bd1477bcd3b3f34ba625a2f4d6',
    '/permission':
      '21067677a3d1c372f1335735da5e62e2f15bf29f8d6e0a3de67205a438b71204',
    '/token_dispenser':
      'd2c33768dd9ab246edd76d06824f576a18f5990956d0047f2505e8a4d1ba98e3',
    '/update':
      'c886de2ed3c435a5fb80fa065fd610f45dd7d02a59a37964466c44301f67398e',
  },
  processes: {
    ime: '1296f5131f9f712e398a4ead505c6886ed9f185f464ccd2ef8cd9cc8f43f2d8f',
    outbox: 'b8f015d40689cb508e8bf7d7fba9700ff829d9fb841415708716cc6937ada0af',
    'token-dispenser':
      '8db82683fc1a3cfaaae6a613854145761aeee566ce00e9e85be35a5d92bb8fde',
  },
  frontendBackend:
    'b0aaeb08ae26d2d4042462a307c75de742c102f5a785dca6df521e9f012c22b8',
  total: '47a0288d0b135028d728489d51877bd6cb9f583b5dc2b8ae4d3798823432bd91',
} as const;
