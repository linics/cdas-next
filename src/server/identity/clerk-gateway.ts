import { clerkClient } from "@clerk/nextjs/server";

export type ClerkUserReference = Readonly<{ id: string }>;

export type CreateClerkUsernamePasswordUserInput = Readonly<{
  externalId: string;
  username: string;
  password: string;
}>;

/**
 * Small, injectable boundary around Clerk's backend API. Password-bearing
 * inputs stay only in the call stack and are never returned or logged.
 */
export interface ClerkIdentityGateway {
  findUserById(userId: string): Promise<ClerkUserReference | null>;
  findUserByExternalId(externalId: string): Promise<ClerkUserReference | null>;
  createUsernamePasswordUser(
    input: CreateClerkUsernamePasswordUserInput,
  ): Promise<ClerkUserReference>;
  resetPassword(userId: string, password: string): Promise<void>;
}

export async function createClerkIdentityGateway(): Promise<ClerkIdentityGateway> {
  const client = await clerkClient();

  return {
    async findUserById(userId) {
      const result = await client.users.getUserList({
        userId: [userId],
        limit: 1,
      });
      const user = result.data[0];
      return user ? { id: user.id } : null;
    },
    async findUserByExternalId(externalId) {
      const result = await client.users.getUserList({
        externalId: [externalId],
        limit: 1,
      });
      const user = result.data[0];
      return user ? { id: user.id } : null;
    },
    async createUsernamePasswordUser(input) {
      const user = await client.users.createUser({
        externalId: input.externalId,
        username: input.username,
        password: input.password,
      });
      return { id: user.id };
    },
    async resetPassword(userId, password) {
      await client.users.updateUser(userId, {
        password,
        signOutOfOtherSessions: true,
      });
    },
  };
}
