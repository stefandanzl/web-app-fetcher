/**
 * Answers "who is this token?" by asking opencloud itself. We never validate
 * signatures or parse jwts - the idp does that for us via the standard
 * userinfo endpoint. Results are cached per token for a few minutes.
 */
export class Identity {
  private cache = new Map<string, { userId: string; expires: number }>()
  private userinfoEndpoint: string | null = null

  constructor(private readonly ocUrl: string) {}

  private async resolveUserinfoEndpoint(): Promise<string> {
    if (this.userinfoEndpoint) {
      return this.userinfoEndpoint
    }
    try {
      const response = await fetch(`${this.ocUrl}/.well-known/openid-configuration`)
      if (response.ok) {
        const discovery = (await response.json()) as { userinfo_endpoint?: string }
        if (discovery.userinfo_endpoint) {
          this.userinfoEndpoint = discovery.userinfo_endpoint
          return this.userinfoEndpoint
        }
      }
    } catch (error) {
      console.error('openid discovery failed, falling back to /userinfo:', error)
    }
    this.userinfoEndpoint = `${this.ocUrl}/userinfo`
    return this.userinfoEndpoint
  }

  /** returns the stable user id (oidc "sub") for a valid token, null otherwise */
  async userIdFor(token: string): Promise<string | null> {
    const cached = this.cache.get(token)
    if (cached && cached.expires > Date.now()) {
      return cached.userId
    }

    const endpoint = await this.resolveUserinfoEndpoint()
    let userId: string | null = null
    try {
      const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } })
      if (response.ok) {
        const userinfo = (await response.json()) as { sub?: string }
        if (userinfo.sub) {
          userId = userinfo.sub
        }
      }
    } catch (error) {
      console.error('userinfo lookup failed:', error)
      return null
    }

    if (userId) {
      this.cache.set(token, { userId, expires: Date.now() + 5 * 60 * 1000 })
    }
    return userId
  }
}
