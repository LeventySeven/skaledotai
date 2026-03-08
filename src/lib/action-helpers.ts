import { z } from 'zod';

export interface ActionState {
  error?: string;
}

type ValidatedActionFunction<S extends z.ZodTypeAny, T> = (
  data: z.infer<S>
) => Promise<T>;

export function validatedAction<S extends z.ZodTypeAny, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>
) {
  return async (
    _prevState: ActionState,
    formData: FormData
  ): Promise<T> => {
    const result = schema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      const errorMessage = result.error.issues[0]?.message ?? 'Invalid form submission';
      return { error: errorMessage } as T & ActionState;
    }

    return action(result.data);
  };
}
