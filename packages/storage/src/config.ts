import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { createLocalStore } from "./local";
import { createS3Store } from "./s3";
import type { ObjectStore } from "./types";

export type StoreEnv = Record<string, string | undefined>;

function required(env: StoreEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

async function signingKey(env: StoreEnv, region: string): Promise<string> {
  const inline = env.CLOUDFRONT_PRIVATE_KEY;
  if (inline !== undefined && inline !== "") return inline;

  const parameter = env.CLOUDFRONT_PRIVATE_KEY_PARAMETER;
  if (parameter === undefined || parameter === "") {
    throw new Error("CLOUDFRONT_PRIVATE_KEY or CLOUDFRONT_PRIVATE_KEY_PARAMETER is required");
  }

  const client = new SSMClient({ region });
  try {
    const response = await client.send(
      new GetParameterCommand({ Name: parameter, WithDecryption: true }),
    );
    const value = response.Parameter?.Value;
    if (value === undefined || value === "") {
      throw new Error("CLOUDFRONT_PRIVATE_KEY_PARAMETER has no value");
    }
    return value;
  } finally {
    client.destroy();
  }
}

export async function buildStoreFromEnv(env: StoreEnv): Promise<ObjectStore> {
  const driver = env.STORAGE_DRIVER;

  if (driver === "local") {
    return createLocalStore(
      env.STORAGE_ROOT && env.STORAGE_ROOT !== "" ? env.STORAGE_ROOT : ".storage",
    );
  }

  if (driver !== "s3") {
    throw new Error("STORAGE_DRIVER must be local or s3");
  }

  const region = required(env, "AWS_REGION");
  return createS3Store({
    bucket: required(env, "S3_BUCKET"),
    region,
    domain: required(env, "CLOUDFRONT_DOMAIN"),
    keyPairId: required(env, "CLOUDFRONT_KEY_PAIR_ID"),
    privateKey: await signingKey(env, region),
  });
}
