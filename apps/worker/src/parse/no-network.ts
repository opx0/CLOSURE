import dns from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'

export class NetworkDuringParse extends Error {
  constructor(what: string) {
    super(`parse step attempted ${what}; repository parsing runs with no network (ADR-016)`)
    this.name = 'NetworkDuringParse'
  }
}

// Repository code is never executed, so nothing here should ever want the network. This turns
// "should never" into "cannot": a parse step that reaches out fails loudly instead of quietly
// fetching something from an untrusted repository's configuration.
export function forbidNetwork(): void {
  const refuse = (what: string): never => {
    throw new NetworkDuringParse(what)
  }
  const refusing = (what: string) => (() => refuse(what)) as unknown

  net.Socket.prototype.connect = refusing('a TCP connection') as typeof net.Socket.prototype.connect
  net.connect = refusing('net.connect') as typeof net.connect
  net.createConnection = refusing('net.createConnection') as typeof net.createConnection
  tls.connect = refusing('a TLS connection') as typeof tls.connect
  dns.lookup = refusing('a DNS lookup') as typeof dns.lookup
  dns.promises.lookup = refusing('a DNS lookup') as typeof dns.promises.lookup
  globalThis.fetch = refusing('fetch') as typeof globalThis.fetch
}
