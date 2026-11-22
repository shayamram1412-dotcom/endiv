import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { DEFAULT_SETTINGS, type BusinessSettings } from '@shared/settings.ts';

/** Business settings (defaults the business controls). Falls back to built-in defaults while loading. */
export function useSettings(): BusinessSettings {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<BusinessSettings>('/admin/settings'), staleTime: 5 * 60_000 });
  return q.data ?? DEFAULT_SETTINGS;
}
