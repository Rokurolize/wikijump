#define _GNU_SOURCE

#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

static bool ipv4_loopback(const struct in_addr *address) {
    const uint32_t value = ntohl(address->s_addr);
    return (value >> 24) == 127 || value == 0;
}

static bool ipv6_loopback(const struct in6_addr *address) {
    static const struct in6_addr any = IN6ADDR_ANY_INIT;
    static const struct in6_addr loopback = IN6ADDR_LOOPBACK_INIT;
    if (memcmp(address, &any, sizeof(*address)) == 0 ||
        memcmp(address, &loopback, sizeof(*address)) == 0) {
        return true;
    }
    if (IN6_IS_ADDR_V4MAPPED(address)) {
        struct in_addr mapped;
        memcpy(&mapped, &address->s6_addr[12], sizeof(mapped));
        return ipv4_loopback(&mapped);
    }
    return false;
}

static bool sockaddr_allowed(const struct sockaddr *address, socklen_t length) {
    if (address == NULL) {
        return true;
    }
    if (address->sa_family == AF_INET) {
        if (length < sizeof(struct sockaddr_in)) {
            return false;
        }
        return ipv4_loopback(&((const struct sockaddr_in *)address)->sin_addr);
    }
    if (address->sa_family == AF_INET6) {
        if (length < sizeof(struct sockaddr_in6)) {
            return false;
        }
        return ipv6_loopback(&((const struct sockaddr_in6 *)address)->sin6_addr);
    }
    return true;
}

static bool hostname_allowed(const char *node) {
    if (node == NULL || node[0] == '\0') {
        return true;
    }
    if (strcasecmp(node, "localhost") == 0) {
        return true;
    }
    const size_t length = strlen(node);
    static const char suffix[] = ".localhost";
    if (length >= sizeof(suffix) - 1 &&
        strcasecmp(node + length - (sizeof(suffix) - 1), suffix) == 0) {
        return true;
    }

    struct in_addr ipv4;
    if (inet_pton(AF_INET, node, &ipv4) == 1) {
        return ipv4_loopback(&ipv4);
    }
    struct in6_addr ipv6;
    if (inet_pton(AF_INET6, node, &ipv6) == 1) {
        return ipv6_loopback(&ipv6);
    }
    return false;
}

static void append_block_log(const char *operation, const char *target) {
    const char *path = getenv("WIKIJUMP_TEST_NETWORK_BLOCK_LOG");
    if (path == NULL || path[0] == '\0') {
        return;
    }
    const int fd = (int)syscall(SYS_openat, AT_FDCWD, path,
                                O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                                0600);
    if (fd < 0) {
        return;
    }
    char executable[256] = {0};
    const ssize_t executable_length =
        (ssize_t)syscall(SYS_readlinkat, AT_FDCWD, "/proc/self/exe", executable,
                         sizeof(executable) - 1);
    if (executable_length <= 0) {
        snprintf(executable, sizeof(executable), "<unknown-executable>");
    } else {
        executable[executable_length] = '\0';
    }

    char command[512] = {0};
    const int command_fd = (int)syscall(SYS_openat, AT_FDCWD, "/proc/self/cmdline",
                                        O_RDONLY | O_CLOEXEC, 0);
    if (command_fd >= 0) {
        const ssize_t command_length =
            (ssize_t)syscall(SYS_read, command_fd, command, sizeof(command) - 1);
        (void)syscall(SYS_close, command_fd);
        if (command_length > 0) {
            for (ssize_t index = 0; index < command_length; index++) {
                if (command[index] == '\0' || command[index] == '\n' ||
                    command[index] == '\r' || command[index] == '\t') {
                    command[index] = ' ';
                }
            }
            command[command_length] = '\0';
        }
    }
    if (command[0] == '\0') {
        snprintf(command, sizeof(command), "<unknown-command>");
    }

    char line[1024];
    const int length = snprintf(
        line, sizeof(line), "%s\t%s\tpid=%ld\texe=%s\tcmd=%s\n", operation,
        target == NULL ? "<unknown>" : target, (long)getpid(), executable,
        command);
    if (length > 0) {
        const size_t count = (size_t)length < sizeof(line) ? (size_t)length
                                                           : sizeof(line) - 1;
        (void)syscall(SYS_write, fd, line, count);
    }
    (void)syscall(SYS_close, fd);
}

static void format_sockaddr(const struct sockaddr *address, socklen_t length,
                            char *output, size_t output_size) {
    if (address == NULL) {
        snprintf(output, output_size, "<connected-socket>");
        return;
    }
    if (address->sa_family == AF_INET && length >= sizeof(struct sockaddr_in)) {
        const struct sockaddr_in *ipv4 = (const struct sockaddr_in *)address;
        char host[INET_ADDRSTRLEN] = {0};
        if (inet_ntop(AF_INET, &ipv4->sin_addr, host, sizeof(host)) == NULL) {
            snprintf(host, sizeof(host), "<invalid-ipv4>");
        }
        snprintf(output, output_size, "%s:%u", host, ntohs(ipv4->sin_port));
        return;
    }
    if (address->sa_family == AF_INET6 && length >= sizeof(struct sockaddr_in6)) {
        const struct sockaddr_in6 *ipv6 = (const struct sockaddr_in6 *)address;
        char host[INET6_ADDRSTRLEN] = {0};
        if (inet_ntop(AF_INET6, &ipv6->sin6_addr, host, sizeof(host)) == NULL) {
            snprintf(host, sizeof(host), "<invalid-ipv6>");
        }
        snprintf(output, output_size, "[%s]:%u", host, ntohs(ipv6->sin6_port));
        return;
    }
    snprintf(output, output_size, "family=%d", address->sa_family);
}

static int block_sockaddr(const char *operation, const struct sockaddr *address,
                          socklen_t length) {
    if (sockaddr_allowed(address, length)) {
        return 0;
    }
    char target[160];
    format_sockaddr(address, length, target, sizeof(target));
    append_block_log(operation, target);
    errno = ENETUNREACH;
    return -1;
}

int connect(int socket_fd, const struct sockaddr *address, socklen_t length) {
    static int (*real_connect)(int, const struct sockaddr *, socklen_t) = NULL;
    if (block_sockaddr("connect", address, length) != 0) {
        return -1;
    }
    if (real_connect == NULL) {
        real_connect = dlsym(RTLD_NEXT, "connect");
    }
    if (real_connect == NULL) {
        errno = ENOSYS;
        return -1;
    }
    return real_connect(socket_fd, address, length);
}

ssize_t sendto(int socket_fd, const void *buffer, size_t length, int flags,
               const struct sockaddr *destination, socklen_t destination_length) {
    static ssize_t (*real_sendto)(int, const void *, size_t, int,
                                  const struct sockaddr *, socklen_t) = NULL;
    if (destination != NULL &&
        block_sockaddr("sendto", destination, destination_length) != 0) {
        return -1;
    }
    if (real_sendto == NULL) {
        real_sendto = dlsym(RTLD_NEXT, "sendto");
    }
    if (real_sendto == NULL) {
        errno = ENOSYS;
        return -1;
    }
    return real_sendto(socket_fd, buffer, length, flags, destination,
                       destination_length);
}

ssize_t sendmsg(int socket_fd, const struct msghdr *message, int flags) {
    static ssize_t (*real_sendmsg)(int, const struct msghdr *, int) = NULL;
    if (message != NULL && message->msg_name != NULL &&
        block_sockaddr("sendmsg", message->msg_name,
                       (socklen_t)message->msg_namelen) != 0) {
        return -1;
    }
    if (real_sendmsg == NULL) {
        real_sendmsg = dlsym(RTLD_NEXT, "sendmsg");
    }
    if (real_sendmsg == NULL) {
        errno = ENOSYS;
        return -1;
    }
    return real_sendmsg(socket_fd, message, flags);
}

int sendmmsg(int socket_fd, struct mmsghdr *messages, unsigned int message_count,
             int flags) {
    static int (*real_sendmmsg)(int, struct mmsghdr *, unsigned int, int) = NULL;
    for (unsigned int index = 0; index < message_count; index++) {
        if (messages[index].msg_hdr.msg_name != NULL &&
            block_sockaddr("sendmmsg", messages[index].msg_hdr.msg_name,
                           (socklen_t)messages[index].msg_hdr.msg_namelen) != 0) {
            return -1;
        }
    }
    if (real_sendmmsg == NULL) {
        real_sendmmsg = dlsym(RTLD_NEXT, "sendmmsg");
    }
    if (real_sendmmsg == NULL) {
        errno = ENOSYS;
        return -1;
    }
    return real_sendmmsg(socket_fd, messages, message_count, flags);
}

int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints, struct addrinfo **result) {
    static int (*real_getaddrinfo)(const char *, const char *,
                                   const struct addrinfo *, struct addrinfo **) = NULL;
    if (!hostname_allowed(node)) {
        append_block_log("getaddrinfo", node);
        return EAI_NONAME;
    }
    if (real_getaddrinfo == NULL) {
        real_getaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo");
    }
    if (real_getaddrinfo == NULL) {
        return EAI_SYSTEM;
    }
    return real_getaddrinfo(node, service, hints, result);
}
