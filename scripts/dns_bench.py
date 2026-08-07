#!/usr/bin/env python3
"""测试多个 DNS 服务器对国内常见网站的解析速度。

支持的 DNS 类型：
  - DoH JSON API（阿里、腾讯）
  - 明文 UDP DNS（114/223/218）

用法：
  python3 scripts/dns_bench.py            # 默认每个域名测 3 次
  python3 scripts/dns_bench.py -n 5       # 指定次数
  python3 scripts/dns_bench.py --domains www.baidu.com,www.taobao.com
"""

import argparse
import json
import socket
import ssl
import struct
import statistics
import sys
import time
import urllib.request

# DoH JSON API（/resolve 端点，返回 application/dns-json）
DOH_SERVERS = {
    "阿里DoH(ali)": "https://dns.alidns.com/resolve",
    "腾讯DoH(pub)": "https://doh.pub/resolve",
}

# 明文 UDP DNS
PLAIN_SERVERS = {
    "114DNS(114)": "114.114.114.114",
    "阿里DNS(223)": "223.5.5.5",
    "江苏电信(218)": "218.2.2.2",
}

# 国内常见服务域名
DEFAULT_DOMAINS = [
    "www.baidu.com",
    "www.taobao.com",
    "www.jd.com",
    "www.douyin.com",
    "www.qq.com",
    "www.bilibili.com",
    "www.163.com",
    "www.sina.com.cn",
]


def build_dns_query(domain: bytes) -> bytes:
    """构造一条最简单的 A 记录 DNS 查询报文。"""
    txid = 0x1234
    flags = 0x0100  # 递归请求 (RD)
    header = struct.pack(">HHHHHH", txid, flags, 1, 0, 0, 0)
    parts = domain.split(b".")
    qname = b"".join(bytes([len(p)]) + p for p in parts) + b"\x00"
    question = qname + struct.pack(">HH", 1, 1)  # type=A, class=IN
    return header + question


def parse_dns_response(data: bytes):
    """从 DNS 响应中提取所有 A 记录的 IPv4。"""
    if len(data) < 12:
        return []
    ancount = struct.unpack(">H", data[6:8])[0]
    offset = 12
    # 跳过 Question 段
    while offset < len(data) and data[offset] != 0:
        offset += data[offset] + 1
    offset += 5  # null byte + QTYPE(2) + QCLASS(2)

    ips = []
    for _ in range(ancount):
        if offset >= len(data):
            break
        # NAME：压缩指针 0xC0xx 占 2 字节，否则以 0 结尾
        if data[offset] & 0xC0 == 0xC0:
            offset += 2
        else:
            while offset < len(data) and data[offset] != 0:
                offset += data[offset] + 1
            offset += 1
        if offset + 10 > len(data):
            break
        rtype, _rclass, _ttl, rdlength = struct.unpack(">HHIH", data[offset:offset + 10])
        offset += 10
        if rtype == 1 and rdlength == 4:
            ips.append(".".join(str(b) for b in data[offset:offset + 4]))
        offset += rdlength
    return ips


def query_plain(server: str, domain: str, timeout: float = 3.0):
    """通过 UDP 明文查询，返回 (ips, 耗时秒) 或 (None, 异常对象)。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        query = build_dns_query(domain.encode())
        start = time.perf_counter()
        sock.sendto(query, (server, 53))
        data, _ = sock.recvfrom(2048)
        elapsed = time.perf_counter() - start
        return parse_dns_response(data), elapsed
    except (socket.timeout, OSError) as e:
        return None, e
    finally:
        sock.close()


def query_doh(url: str, domain: str, timeout: float = 5.0):
    """通过 DoH JSON API 查询，返回 (ips, 耗时秒) 或 (None, 异常对象)。"""
    full = f"{url}?name={domain}&type=A"
    ctx = ssl.create_default_context()
    req = urllib.request.Request(full, headers={"Accept": "application/dns-json",
                                                 "User-Agent": "dns-bench/1.0"})
    try:
        start = time.perf_counter()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read()
        elapsed = time.perf_counter() - start
        data = json.loads(body)
        ips = [a["data"] for a in data.get("Answer", []) if a.get("type") == 1]
        return ips, elapsed
    except Exception as e:
        return None, e


def run_one(server, domain, kind):
    if kind == "doh":
        return query_doh(server, domain)
    return query_plain(server, domain)


def main():
    parser = argparse.ArgumentParser(description="DNS 解析速度对比测试")
    parser.add_argument("-n", "--repeat", type=int, default=3,
                        help="每个域名×DNS 重复测试次数（默认 3）")
    parser.add_argument("--domains", type=str, default=None,
                        help="自定义域名列表，逗号分隔")
    args = parser.parse_args()

    domains = (args.domains.split(",") if args.domains else DEFAULT_DOMAINS)
    n = max(1, args.repeat)

    servers = []
    for name, url in DOH_SERVERS.items():
        servers.append((name, "doh", url))
    for name, ip in PLAIN_SERVERS.items():
        servers.append((name, "plain", ip))

    print(f"DNS 解析速度测试（每项 {n} 次取均值）")
    print("=" * 86)
    header = f"{'域名':<22} {'DNS':<16} {'解析IP':<16} {'平均(ms)':>9} {'最小(ms)':>9} {'失败':>4}"
    print(header)
    print("-" * 86)

    # 汇总：{dns_name: {总耗时列表, 失败数}}
    summary = {name: {"times": [], "fails": 0} for name, _, _ in servers}

    for domain in domains:
        for sname, kind, sval in servers:
            times = []
            last_ips = []
            fails = 0
            for _ in range(n):
                ips, res = run_one(sval, domain, kind)
                if isinstance(res, float):
                    times.append(res * 1000.0)
                    last_ips = ips or []
                else:
                    fails += 1
            if times:
                avg = statistics.mean(times)
                mn = min(times)
                ip_str = last_ips[0] if last_ips else "无A记录"
                avg_str = f"{avg:.1f}"
                min_str = f"{mn:.1f}"
                summary[sname]["times"].extend(times)
            else:
                ip_str = "-"
                avg_str = "-"
                min_str = "-"
            summary[sname]["fails"] += fails
            fail_str = f"{fails}" if fails else "-"
            print(f"{domain:<22} {sname:<16} {ip_str:<16} {avg_str:>9} {min_str:>9} {fail_str:>4}")
        print()

    # 汇总
    print("=" * 86)
    print("汇总：各 DNS 总体表现")
    print("-" * 86)
    print(f"{'DNS':<16} {'成功次数':>8} {'平均(ms)':>10} {'中位(ms)':>10} {'最小(ms)':>10} {'最大(ms)':>10} {'失败':>5}")
    print("-" * 86)
    ranked = []
    for sname, _, _ in servers:
        ts = summary[sname]["times"]
        if ts:
            ranked.append((sname, len(ts), statistics.mean(ts), statistics.median(ts),
                           min(ts), max(ts), summary[sname]["fails"]))
        else:
            ranked.append((sname, 0, None, None, None, None, summary[sname]["fails"]))
    ranked.sort(key=lambda x: (x[2] is None, x[2] or 0))
    for sname, cnt, avg, med, mn, mx, fails in ranked:
        if avg is None:
            print(f"{sname:<16} {0:>8} {'全部失败':>10} {'-':>10} {'-':>10} {'-':>10} {fails:>5}")
        else:
            print(f"{sname:<16} {cnt:>8} {avg:>10.1f} {med:>10.1f} {mn:>10.1f} {mx:>10.1f} {fails:>5}")

    print()
    print("提示：")
    print(" - 数值越小越快。DoH 包含 TLS 握手开销，明文 UDP 通常更快但无加密。")
    print(" - 国内 DNS 对国内域名一般均较快，差异主要在网络链路与缓存命中。")
    print(" - 若 DoH 平均耗时明显偏高，可能是首次连接需要建立 TLS。")


if __name__ == "__main__":
    sys.exit(main())
