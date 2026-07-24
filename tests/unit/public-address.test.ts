import { describe, expect, it } from "vitest";

import { isPublicAddress } from "../../src/remote/public-address";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2003::1",
    "2400:cb00::1",
    "2a00:1450::1",
    "2c0f:f248::1",
  ])("accepts globally routable address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2004::1",
    "2200::1",
    "3ffe::1",
    "3fff::1",
    "3f00::1",
    "3fe0::1",
    "3fff:1000::1",
    "not-an-address",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
