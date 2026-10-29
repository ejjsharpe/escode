#include <CoreServices/CoreServices.h>
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

static void revalidate_source(const char *path, const struct stat *expected) {
  int current = scoped_open(3, path, O_RDONLY);
  struct stat actual;
  if (fstat(current, &actual)) fail("Reinspect operation source");
  if (actual.st_dev != expected->st_dev || actual.st_ino != expected->st_ino) {
    errno = ESTALE;
    fail("Source changed after preflight");
  }
  close(current);
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

static void safe_tree(int fd) {
  struct stat info;
  if (fstat(fd, &info)) fail("Inspect operation source");
  if (S_ISREG(info.st_mode)) {
    if (info.st_nlink != 1) { errno = ENOTSUP; fail("Operation unavailable: hard-linked file"); }
    return;
  }
  if (!S_ISDIR(info.st_mode)) { errno = ENOTSUP; fail("Unsupported source"); }
#ifdef ESCODE_TEST_PREFLIGHT
  // Only the separately compiled race-test helper has this synchronization point.
  static int paused;
  if (!paused) {
    paused = 1;
    char resume;
    if (write(4, "ready", 5) != 5 || read(5, &resume, 1) != 1) {
      errno = EIO; fail("Synchronize preflight test");
    }
  }
#endif
  DIR *dir = fdopendir(dup(fd));
  if (!dir) fail("Inspect operation folder");
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (!strcasecmp(entry->d_name, ".git")) { errno = EPERM; fail("Protected metadata"); }
    int child = scoped_open(fd, entry->d_name, O_RDONLY);
    safe_tree(child);
    close(child);
    errno = 0;
  }
  if (errno) fail("Inspect operation folder");
  closedir(dir);
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

  if (!strcmp(operation, "create")) {
    if (argc != 6 || !argv[3][0] || strchr(argv[3], '/') || strchr(argv[3], '\\') ||
        !strcmp(argv[3], ".") || !strcmp(argv[3], "..") || !strcasecmp(argv[3], ".git")) {
      errno = EINVAL; fail("Invalid basename");
    }
    int parent = scoped_open(3, argv[2], O_RDONLY | O_DIRECTORY);
    struct stat info;
    if (fstat(parent, &info)) fail("Inspect create parent");
    char identity[100];
    snprintf(identity, sizeof(identity), "%llu:%llu", (unsigned long long)info.st_dev, (unsigned long long)info.st_ino);
    if (strcmp(identity, argv[5])) { errno = ESTALE; fail("Create parent replaced"); }
    revalidate_source(argv[2], &info);
    if (!strcmp(argv[4], "folder")) {
      if (mkdirat(parent, argv[3], 0700)) fail("Create folder (name must be free)");
    } else if (!strcmp(argv[4], "file")) {
      int fd = scoped_open(parent, argv[3], O_WRONLY | O_CREAT | O_EXCL);
      if (close(fd)) fail("Close new file");
    } else { errno = EINVAL; fail("Invalid create kind"); }
    return 0;
  }

  if (!strcmp(operation, "identity") || !strcmp(operation, "move") || !strcmp(operation, "trash")) {
    int fd = scoped_open(3, argv[2], O_RDONLY);
    struct stat info;
    if (fstat(fd, &info)) fail("Inspect source");
    if (!strcmp(operation, "identity")) {
      printf("%llu:%llu", (unsigned long long)info.st_dev, (unsigned long long)info.st_ino);
      return 0;
    }
    if (argc != 5) { errno = EINVAL; fail("Invalid operation"); }
    char identity[100];
    snprintf(identity, sizeof(identity), "%llu:%llu", (unsigned long long)info.st_dev, (unsigned long long)info.st_ino);
    if (strcmp(identity, argv[4])) { errno = ESTALE; fail("Source replaced"); }
    safe_tree(fd);
    // shortcut: this final scoped identity check is not atomic with the native mutation;
    // upgrade if cross-process transactional file operations become a requirement.
    revalidate_source(argv[2], &info);
    if (!strcmp(operation, "move")) {
      if (renameatx_np(3, argv[2], 3, argv[3], RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH))
        fail("Move source (destination must be free)");
      return 0;
    }
    // Native Trash uses a filesystem object reference, never a late path lookup.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    char path[PATH_MAX];
    FSRef source, target;
    if (fcntl(fd, F_GETPATH, path)) fail("Locate Trash source");
    OSStatus status = FSPathMakeRefWithOptions((UInt8 *)path, kFSPathMakeRefDoNotFollowLeafSymlink, &source, NULL);
    if (status) { errno = EIO; fail("Create Trash reference"); }
    if (FSRefMakePath(&source, (UInt8 *)path, sizeof(path))) { errno = EIO; fail("Resolve Trash reference"); }
    int referenced = open(path, O_RDONLY | O_NOFOLLOW_ANY | O_NONBLOCK);
    struct stat actual;
    if (referenced < 0 || fstat(referenced, &actual) || actual.st_dev != info.st_dev || actual.st_ino != info.st_ino) {
      errno = ESTALE; fail("Trash source changed");
    }
    close(referenced);
    // A matching native reference alone does not prove the source is still in scope.
    revalidate_source(argv[2], &info);
    status = FSMoveObjectToTrashSync(&source, &target, 0);
    if (status) { fprintf(stderr, "5:Native Trash failed (%d); no permanent deletion attempted\n", (int)status); return 1; }
    if (!FSRefMakePath(&target, (UInt8 *)path, sizeof(path))) printf("%s", path);
#pragma clang diagnostic pop
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
