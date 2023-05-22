resource "github_repository_file" "this" {
  lifecycle {
    ignore_changes = [
      commit_author,
      commit_email,
      overwrite_on_create,
    ]
  }
}
