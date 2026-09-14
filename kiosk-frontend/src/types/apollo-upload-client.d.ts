declare module 'apollo-upload-client/UploadHttpLink.mjs' {
  import { ApolloLink } from '@apollo/client';
  import type { HttpOptions } from '@apollo/client/link/http';

  export default class UploadHttpLink extends ApolloLink {
    constructor(options?: HttpOptions);
  }
}
