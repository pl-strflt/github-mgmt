resource "github_team" "this" {
  lifecycle {
    ignore_changes = [id]
  }
}

resource "github_repository" "this" {
  lifecycle {
    ignore_changes = [id]
  }
}


resource "github_branch_protection" "this" {
  lifecycle {
    ignore_changes = [id]
  }
}

resource "github_repository_file" "this" {
  lifecycle {
    ignore_changes = [id]
  }
}
