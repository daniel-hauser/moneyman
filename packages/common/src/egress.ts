import z from "zod/v4";

const PortSchema = z.number().int().min(1).max(65_535);
const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.:-]+$/);

export const SQL_EGRESS_PORT = 15_432;

export const EgressConfigSchema = z
  .strictObject({
    mode: z.enum(["public", "allowlist"]),
    destinations: z
      .array(
        z.strictObject({
          hostname: HostnameSchema,
          ports: z.array(PortSchema).min(1),
        }),
      )
      .default([]),
    tcpForwards: z
      .array(
        z.strictObject({
          listenPort: PortSchema,
          hostname: HostnameSchema,
          port: PortSchema,
        }),
      )
      .default([]),
    listenPort: PortSchema.default(8080),
  })
  .superRefine((config, context) => {
    const listenPorts = new Set([config.listenPort]);
    config.tcpForwards.forEach((forward, index) => {
      if (listenPorts.has(forward.listenPort)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate egress listen port ${forward.listenPort}`,
          path: ["tcpForwards", index, "listenPort"],
        });
      }
      listenPorts.add(forward.listenPort);
    });
  });

export type EgressConfig = z.infer<typeof EgressConfigSchema>;
export type EgressDestination = EgressConfig["destinations"][number];
