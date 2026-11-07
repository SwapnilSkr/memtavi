import { expect, test } from "bun:test";
import { isPublicAddress } from "./address";

const ipv4Cases: Array<[string, boolean]> = [
  ["8.8.8.8", true],
  ["1.1.1.1", true],
  ["93.184.216.34", true],
  ["172.32.0.1", true],
  ["198.20.0.1", true],
  ["100.128.0.1", true],
  ["192.0.1.1", true],
  ["127.0.0.1", false],
  ["127.255.255.254", false],
  ["10.0.0.1", false],
  ["10.255.255.255", false],
  ["172.16.0.1", false],
  ["172.31.255.255", false],
  ["192.168.0.1", false],
  ["169.254.169.254", false],
  ["100.64.0.1", false],
  ["100.127.255.255", false],
  ["192.0.0.1", false],
  ["192.0.2.1", false],
  ["198.18.0.1", false],
  ["198.19.255.255", false],
  ["198.51.100.1", false],
  ["203.0.113.1", false],
  ["224.0.0.1", false],
  ["239.255.255.250", false],
  ["240.0.0.1", false],
  ["255.255.255.255", false],
  ["0.0.0.0", false],
  ["0.1.2.3", false],
  ["not-an-ip", false],
  ["", false],
  [" 8.8.8.8 ", true],
];

const ipv6Cases: Array<[string, boolean]> = [
  ["2606:4700:4700::1111", true],
  ["2001:4860:4860::8888", true],
  ["2001:4860:4860:0:0:0:0:8888", true],
  ["::1", false],
  ["::", false],
  ["fc00::1", false],
  ["fd12:3456:789a::1", false],
  ["fe80::1", false],
  ["fe80::1%en0", false],
  ["ff02::1", false],
  ["ff00::", false],
  ["2001:db8::1", false],
  ["2001:db8:0:0:0:0:0:1", false],
  ["2001::1", false],
  ["2002:7f00:1::", false],
  ["3fff::1", false],
  ["64:ff9b::808:808", false],
  ["::ffff:8.8.8.8", true],
  ["::ffff:808:808", true],
  ["::ffff:127.0.0.1", false],
  ["::ffff:7f00:1", false],
  ["::ffff:10.0.0.1", false],
  ["::ffff:169.254.169.254", false],
  ["::127.0.0.1", false],
  ["not-an-ip", false],
];

test.each(ipv4Cases)("isPublicAddress(%s) matches the IPv4 expectation", (address, expected) => {
  expect(isPublicAddress(address)).toBe(expected);
});

test.each(ipv6Cases)("isPublicAddress(%s) matches the IPv6 expectation", (address, expected) => {
  expect(isPublicAddress(address)).toBe(expected);
});
