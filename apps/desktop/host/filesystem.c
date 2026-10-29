#include <copyfile.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define LIMIT (2 * 1024 * 1024)
#define SCOPED (O_NOFOLLOW_ANY | O_RESOLVE_BENEATH | O_NONBLOCK)

static const char *owned_temp;

static void fail(const char *message) {
  fprintf(stderr, "%d:%s: %s\n", errno, message, strerror(errno));
  if (owned_temp &&
      unlinkat(3, owned_temp, AT_SYMLINK_NOFOLLOW_ANY | AT_RESOLVE_BENEATH) &&
      errno != ENOENT)
    fprintf(stderr, "Temporary file remains: %s\n", owned_temp);
  exit(1);
}

static int scoped_open(int dir, const char *path, int flags) {
  int fd = openat(dir, path, flags | SCOPED, 0600);
  if (fd < 0) fail("Open checkout path");
  return fd;
}

static struct stat regular(int fd) {
  struct stat info;
  if (fstat(fd, &info)) fail("Inspect file");
  if (!S_ISREG(info.st_mode)) {
    errno = ENOTSUP;
    fail("Text unavailable: not a regular file");
  }
  if (info.st_size > LIMIT) {
    errno = EFBIG;
    fail("Text unavailable: file exceeds 2 MiB");
  }
  return info;
}

static void transfer(int from, int to) {
  char bytes[65536];
  size_t total = 0;
  for (;;) {
    ssize_t n = read(from, bytes, sizeof(bytes));
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) fail("Read file");
    if (!n) return;
    total += (size_t)n;
    if (total > LIMIT) {
      errno = EFBIG;
      fail("Text unavailable: file exceeds 2 MiB");
    }
    for (ssize_t offset = 0; offset < n;) {
      ssize_t written = write(to, bytes + offset, (size_t)(n - offset));
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) fail("Write file");
      offset += written;
    }
  }
}

int main(int argc, char **argv) {
  // Descriptor 3 is the host-validated checkout, inherited without a path lookup.
  struct stat root;
  if (fstat(3, &root) || !S_ISDIR(root.st_mode) || argc < 3) {
    errno = EINVAL;
    fail("Invalid filesystem request");
  }
  const char *operation = argv[1];
  if (!strcmp(operation, "git")) {
    if (fchdir(3) || fcntl(3, F_SETFD, FD_CLOEXEC)) fail("Enter checkout");
    execv(argv[2], argv + 2);
    fail("Start Git");
  }
  if (!strcmp(operation, "read")) {
    int fd = scoped_open(3, argv[2], O_RDONLY);
    regular(fd);
    transfer(fd, STDOUT_FILENO);
    return 0;
  }
  if (!strcmp(operation, "list")) {
    int fd = scoped_open(3, argv[2], O_RDONLY | O_DIRECTORY);
    DIR *dir = fdopendir(fd);
    if (!dir) fail("Browse directory");
    struct dirent *entry;
    for (;;) {
      errno = 0;
      entry = readdir(dir);
      if (!entry) {
        if (errno) fail("Browse directory");
        break;
      }
      if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..") ||
          !strcasecmp(entry->d_name, ".git")) continue;
      struct stat info;
      if (fstatat(fd, entry->d_name, &info, AT_SYMLINK_NOFOLLOW)) {
        if (errno == ENOENT) continue;
        fail("Inspect directory entry");
      }
      if (!S_ISDIR(info.st_mode) && !S_ISREG(info.st_mode)) continue;
      putchar(S_ISDIR(info.st_mode) ? 'd' : 'f');
      fwrite(entry->d_name, 1, strlen(entry->d_name) + 1, stdout);
    }
    if (ferror(stdout) || closedir(dir)) fail("Browse directory");
    return 0;
  }

  if (!strcmp(operation, "remove")) {
    if (unlinkat(3, argv[2], AT_SYMLINK_NOFOLLOW_ANY | AT_RESOLVE_BENEATH) && errno != ENOENT)
      fail("Remove temporary file");
    return 0;
  }
  if (argc != 4 || !argv[3][0]) {
    errno = EINVAL;
    fail("Invalid save request");
  }
  if (!strcmp(operation, "stage")) {
    int original = scoped_open(3, argv[2], O_RDONLY);
    struct stat info = regular(original);
    if (info.st_nlink != 1) {
      errno = ENOTSUP;
      fail("Save unavailable: file has hard links");
    }
    int temp = scoped_open(3, argv[3], O_RDWR | O_CREAT | O_EXCL);
    owned_temp = argv[3];
    transfer(STDIN_FILENO, temp);
    if (fcopyfile(original, temp, NULL, COPYFILE_METADATA) ||
        fchmod(temp, info.st_mode & 07777) || fsync(temp) || close(temp))
      fail("Stage file");
    return 0;
  }
  if (!strcmp(operation, "replace")) {
    if (renameatx_np(3, argv[3], 3, argv[2],
                     RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH))
      fail("Replace file");
    return 0;
  }
  errno = EINVAL;
  fail("Unknown filesystem request");
}
