import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  LEVEL_ORDER,
  CompetencySchema,
  InterviewFormatSchema,
  LevelSchema,
  PersonaIdSchema,
  PolicyActionSchema,
  PressureLevelSchema,
  RolePackSchema,
  RubricSchema,
} from '@closer/contracts'
import {
  ACTIONS,
  INTERVIEW_FORMATS,
  PERSONAS,
  PRESSURE_INTENSITY,
  ROLE_PACKS,
  RUBRIC_V1,
  validationNotice,
} from '@closer/core'

// Everything the policy is configured by, readable. A session is inspectable only if the thing it
// was configured with is inspectable too.
export const catalogRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/roles',
    {
      schema: {
        summary: 'Role packs, each stating whether any agreement has been measured for it',
        tags: ['catalog'],
        response: {
          200: Type.Object({
            roles: Type.Array(
              Type.Object({ pack: RolePackSchema, notice: Type.String({ minLength: 1 }) }),
            ),
          }),
        },
      },
    },
    async () => ({
      roles: ROLE_PACKS.map((pack) => ({ pack, notice: validationNotice(pack.id) })),
    }),
  )

  app.get(
    '/formats',
    {
      schema: {
        summary: 'Interview format presets derived from published company guidance',
        tags: ['catalog'],
        response: { 200: Type.Object({ formats: Type.Array(InterviewFormatSchema) }) },
      },
    },
    async () => ({ formats: [...INTERVIEW_FORMATS] }),
  )

  app.get(
    '/rubrics',
    {
      schema: {
        summary: 'Rubric v1 with its per-level anchors',
        tags: ['catalog'],
        response: { 200: Type.Object({ rubrics: Type.Array(RubricSchema) }) },
      },
    },
    async () => ({ rubrics: RUBRIC_V1 }),
  )

  app.get(
    '/personas',
    {
      schema: {
        summary: 'Personas as policy configuration — action weights and pressure ceiling',
        tags: ['catalog'],
        response: {
          200: Type.Object({
            personas: Type.Array(
              Type.Object({
                id: PersonaIdSchema,
                pressureCeiling: PressureLevelSchema,
                actionWeights: Type.Record(Type.String(), Type.Number()),
              }),
            ),
          }),
        },
      },
    },
    async () => ({
      personas: Object.entries(PERSONAS).map(([id, config]) => ({
        id: id as keyof typeof PERSONAS,
        pressureCeiling: config.pressureCeiling,
        actionWeights: config.actionWeights as Record<string, number>,
      })),
    }),
  )

  app.get(
    '/actions',
    {
      schema: {
        summary: 'The typed policy actions code chooses between, and what each one probes',
        tags: ['catalog'],
        response: {
          200: Type.Object({
            actions: Type.Array(
              Type.Object({
                action: PolicyActionSchema,
                isPressure: Type.Boolean(),
                probes: Type.Union([CompetencySchema, Type.Null()]),
                intensity: Type.Union([PressureLevelSchema, Type.Null()]),
                description: Type.String({ minLength: 1 }),
              }),
            ),
            levels: Type.Array(LevelSchema),
          }),
        },
      },
    },
    async () => ({
      actions: Object.entries(ACTIONS).map(([action, spec]) => ({
        action: action as keyof typeof ACTIONS,
        isPressure: spec.isPressure,
        probes: spec.probes,
        intensity: PRESSURE_INTENSITY[action as keyof typeof ACTIONS] ?? null,
        description: spec.description,
      })),
      levels: [...LEVEL_ORDER],
    }),
  )
}
