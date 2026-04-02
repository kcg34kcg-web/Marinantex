export async function fetchPortalWithSessionRefresh(input: string, init?: RequestInit): Promise<Response> {
  let response = await fetch(input, init);
  if (response.status !== 401) {
    return response;
  }

  const refreshResult = await fetch('/api/portal/sessions/refresh', {
    method: 'POST',
    cache: 'no-store',
  });

  if (!refreshResult.ok) {
    return response;
  }

  response = await fetch(input, init);
  return response;
}

