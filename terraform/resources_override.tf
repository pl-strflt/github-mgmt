resource "github_repository_file" "this" {
  lifecycle {
    ignore_changes = [
      overwrite_on_create,
    ]
  }
}
