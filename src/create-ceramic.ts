import { CeramicClient } from "@ceramicnetwork/http-client";
import { randomBytes } from "@stablelib/random";
import { Ed25519Provider } from "key-did-provider-ed25519";
import * as ThreeIdResolver from "@ceramicnetwork/3id-did-resolver";
import * as KeyDidResolver from "key-did-resolver";
import { Resolver } from "did-resolver";
import { DID } from "dids";

export async function createCeramic(apiHost: string, seed: Uint8Array) {
  const ceramic = new CeramicClient(apiHost || process.env.CERAMIC_ENDPOINT);
  const provider = new Ed25519Provider(seed);
  const keyDidResolver = KeyDidResolver.getResolver();
  const threeIdResolver = ThreeIdResolver.getResolver(ceramic);
  const resolver = new Resolver({
    ...threeIdResolver,
    ...keyDidResolver,
  });
  // @ts-ignore
  const did = new DID({ provider, resolver: resolver });
  await ceramic.setDID(did);
  await did.authenticate();

  return ceramic;
}
