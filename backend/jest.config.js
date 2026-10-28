const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: 'src',
      testRegex: '\\.spec\\.ts$',
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform,
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      rootDir: '.',
      testRegex: 'test/.*\\.e2e-spec\\.ts$',
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform,
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
  ],
  testTimeout: 30000,
};
