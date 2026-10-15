import type { Topic } from '@levelhead/contracts'

export const NETWORKS_TOPICS: readonly Topic[] = [
  {
    id: 'networks.tcp_udp',
    area: 'networks',
    title: 'TCP vs UDP',
    ask: 'Ask them to compare TCP and UDP and say which one they would use for a specific application and why.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'TCP sets up a connection with a three-way handshake',
        'TCP delivers a reliable, ordered byte stream using sequence numbers, acknowledgements and retransmission',
        'UDP sends independent datagrams with no delivery or ordering guarantee',
      ],
      trade_offs: [
        'TCP pays handshake latency and head-of-line blocking for reliability',
        'UDP has less overhead and latency, but the application must handle loss',
        'TCP has built-in flow control and congestion control; UDP has neither',
      ],
      failure_modes: [
        'one lost packet stalls everything behind it on a TCP stream',
        'UDP datagrams can arrive out of order, duplicated, or not at all',
        'a UDP sender without its own congestion control can flood the network',
      ],
    },
    falsePremise:
      'UDP is unreliable, so nothing important like DNS or video calls is ever sent over it.',
    twist:
      'the application is a multiplayer game where a position update that arrives 200 ms late is useless',
  },
  {
    id: 'networks.url_to_page',
    area: 'networks',
    title: 'What happens when you type a URL',
    ask: 'Ask them to walk through everything that happens from typing a URL into the browser until the page appears.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'DNS resolves the hostname to an IP address, with caches in the browser, the OS and the resolver',
        'a TCP connection and a TLS handshake with the server',
        'an HTTP request and response, then the browser parses the HTML, fetches CSS, scripts and images, and renders',
      ],
      trade_offs: [
        'caching at the DNS, browser and CDN layers makes loads faster but can serve stale content',
        'TLS adds round trips in exchange for confidentiality and integrity',
        'keep-alive and connection reuse avoid repeating the handshakes',
      ],
      failure_modes: [
        'a DNS failure or a stale cached record pointing at the wrong server',
        'an expired or mismatched TLS certificate',
        'a slow render-blocking script or stylesheet delaying the page',
      ],
    },
    falsePremise:
      'The browser does a fresh DNS lookup for every request, including each image on the page, because DNS answers are never cached.',
    twist:
      'users on another continent say the first visit takes eight seconds while repeat visits are fast',
  },
  {
    id: 'networks.https_tls',
    area: 'networks',
    title: 'HTTPS and the TLS handshake',
    ask: 'Ask them what HTTPS adds over HTTP, and to walk through how a TLS handshake sets up a secure connection.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the server sends a certificate chain signed by a certificate authority the client trusts, and proves it holds the matching private key',
        'client and server agree on shared session keys through a key exchange such as ECDHE',
        'after the handshake, symmetric encryption with integrity checks protects every record',
        'TLS 1.3 completes a full handshake in one round trip, down from two in TLS 1.2',
      ],
      trade_offs: [
        'the handshake adds round trips before the first byte; session resumption and TLS 1.3 cut them',
        'public-key cryptography is used only to agree the keys, because symmetric encryption is far faster for bulk data',
        'terminating TLS at the load balancer simplifies certificates but leaves traffic behind it unencrypted unless it is re-encrypted',
      ],
      failure_modes: [
        'an expired certificate, or one that does not match the hostname',
        'a client that skips certificate validation is open to a man-in-the-middle',
        'a leaked private key lets an attacker impersonate the server',
      ],
    },
    falsePremise:
      "HTTPS encrypts every request and response with the server's public key for the whole connection, which is why the certificate is needed.",
    twist:
      'users on mobile networks with 300 ms round trips say the first request on every new connection is slow',
  },
  {
    id: 'networks.dns',
    area: 'networks',
    title: 'DNS resolution',
    ask: 'Ask them to walk through how a hostname is resolved to an IP address, from the browser to the authoritative server.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'after the browser and OS caches, the stub resolver asks a recursive resolver',
        "the recursive resolver walks from a root server to the TLD server to the domain's authoritative server",
        'every answer is cached for its TTL at each level',
        'record types such as A, AAAA, CNAME, MX and NS',
      ],
      trade_offs: [
        'a long TTL cuts lookups and latency but slows down moving to a new IP; a short TTL does the reverse',
        'DNS-based load balancing is simple but coarse, because clients cache the answers',
        'DNS usually runs over UDP for speed and falls back to TCP for large responses',
      ],
      failure_modes: [
        'clients keep using the old address after a record change until the old TTL runs out',
        'cache poisoning when a resolver accepts a forged response, which DNSSEC addresses',
        'an outage at the DNS provider making a healthy site unreachable',
      ],
    },
    falsePremise:
      'The root servers store the IP address of every domain on the internet, and every lookup is answered directly by them.',
    twist:
      'the site must move to a new server tonight, and its A record currently has a 24-hour TTL',
  },
  {
    id: 'networks.tcp_congestion',
    area: 'networks',
    title: 'TCP handshake and congestion control',
    ask: 'Ask them to walk through the TCP three-way handshake and how TCP decides how fast to send.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'SYN, SYN-ACK and ACK exchange initial sequence numbers before any data flows',
        'flow control: the receiver advertises a window of how much it can still buffer',
        'slow start grows the congestion window exponentially until it reaches a threshold or sees loss',
        'additive increase, multiplicative decrease: grow the window steadily and cut it sharply when loss signals congestion',
      ],
      trade_offs: [
        'the handshake costs a round trip before any data; TCP Fast Open and QUIC shave it',
        'slow start protects the network but makes short transfers on a new connection slow',
        'loss-based congestion control reads random loss on a wireless link as congestion and slows down for nothing',
      ],
      failure_modes: [
        "a SYN flood filling the server's queue of half-open connections, countered with SYN cookies",
        'bufferbloat: oversized router buffers delay the loss signal and add large queueing delay',
        'a slow reader advertising a zero window and stalling the sender',
      ],
    },
    falsePremise:
      'Flow control and congestion control are the same mechanism: both just use the window the receiver advertises.',
    twist:
      'the connection now crosses a satellite link with a 600 ms round trip and 1% random packet loss',
  },
  {
    id: 'networks.layers',
    area: 'networks',
    title: 'Network layers (OSI and TCP/IP)',
    ask: 'Ask them to walk through the layers of the network stack and what each layer adds when a web request is sent.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the OSI model has seven layers; the TCP/IP model groups them into link, internet, transport and application',
        'each layer wraps the payload from the layer above in its own header (encapsulation)',
        'IP routes packets between networks by address; TCP or UDP deliver them to a port on the host',
        'Ethernet frames carry packets between devices on one link, addressed by MAC address',
      ],
      trade_offs: [
        'layering lets each layer change independently, such as HTTP running over TCP or over QUIC',
        'every header adds bytes of overhead to every packet',
        'middleboxes such as NAT and firewalls look into higher layers, which adds control but makes new protocols hard to deploy',
      ],
      failure_modes: [
        'an MTU mismatch that fragments large packets or silently drops them',
        'NAT hiding hosts behind one address and breaking inbound connections',
        'a firewall silently dropping packets on a port, which shows up as a timeout rather than a refused connection',
      ],
    },
    falsePremise:
      'IP guarantees that packets arrive in order and without loss, so TCP only exists to add port numbers.',
    twist: 'a user on a VPN can load small pages, but large downloads hang forever',
  },
]
